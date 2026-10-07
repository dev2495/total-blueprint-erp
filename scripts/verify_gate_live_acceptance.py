"""Authenticated, rollback-only acceptance of a deployed gate release.

Run inside the candidate backend container with --expected-sha <full commit>.
Production is required. Explicit --local plus GATE_ACCEPTANCE_ALLOW_LOCAL=1 is
restricted to the isolated tpp_gate_dev_20261007 database for script validation.
All synthetic users, observations, receipts, rate buckets and audit events live
inside one transaction that is always rolled back, including on failure. Existing
users, passwords, plants and ERP masters are never edited. Real bearer/cookie JWT
authentication is used; force_authenticate is intentionally never used.
"""
import argparse
import csv
import hashlib
import io
import json
import logging
import os
import re
import secrets
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()
from cryptography.fernet import Fernet
from PIL import Image
from django.apps import apps
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, transaction
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken
from apps.factory.models import Plant
from apps.gate.models import GateAssignment, GateAuditEvent, GatePublicLink, GatePublicRateBucket, GateRequestReceipt, GoodsLine, GoodsMovement, VisitorVisit
from apps.gate.services import gate_today
from apps.users.models import PermissionAuditLog, Role, User


class AcceptanceFailure(Exception):
    """Messages are fixed descriptions, without response bodies or private data."""


class RollbackAPIClient(APIClient):
    def request(self, **request):
        # APIClient.generic defaults each call to HTTP even when its client
        # defaults specify HTTPS. Preserve the public origin's scheme so
        # production SSL redirects and secure-cookie CSRF checks are exercised.
        request["wsgi.url_scheme"] = self.defaults.get("wsgi.url_scheme", request.get("wsgi.url_scheme", "http"))
        # DRF marks any surrounding atomic block for rollback on expected 4xx
        # responses, even for the public non_atomic_requests views. An isolated
        # per-request savepoint protects the outer acceptance transaction.
        with transaction.atomic():
            return super().request(**request)


def require(condition, message):
    if not condition:
        raise AcceptanceFailure(message)


def api(response, status, message):
    require(response.status_code == status, f"{message}: expected HTTP {status}, received {response.status_code}")
    return response


def body(response):
    return json.dumps(response.json(), sort_keys=True)


def business_snapshot(tables):
    """Hash complete rows in a consistent snapshot, including our own writes."""
    result = {}
    for name, pk in sorted(tables.items()):
        digest, count = hashlib.sha256(), 0
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT to_jsonb(t)::text FROM {connection.ops.quote_name(name)} t ORDER BY {connection.ops.quote_name(pk)}")
            while rows := cursor.fetchmany(1000):
                for row in rows:
                    digest.update(row[0].encode())
                    digest.update(b"\n")
                    count += 1
        result[name] = (count, digest.hexdigest())
    return result


def main(expected_sha, local):
    require(bool(re.fullmatch(r"[0-9a-f]{40}", expected_sha)), "A full expected candidate SHA is required")
    require(os.getenv("APP_BUILD_SHA", "") == expected_sha, "Runtime APP_BUILD_SHA does not match the expected candidate")
    require(connection.vendor == "postgresql", "Acceptance requires PostgreSQL and its audit guard")
    if local:
        require(os.getenv("GATE_ACCEPTANCE_ALLOW_LOCAL") == "1" and settings.DATABASES["default"]["NAME"] == "tpp_gate_dev_20261007" and settings.IS_LOCAL_DEV, "Local acceptance is restricted to the explicitly authorized isolated QA database")
    else:
        require(settings.IS_PRODUCTION and not settings.DEBUG, "Acceptance must run in the deployed production backend")
    origin = urlparse(getattr(settings, "GATE_PUBLIC_ORIGIN", "") or os.getenv("GATE_PUBLIC_ORIGIN", ""))
    require(bool(origin.netloc) and origin.scheme in ({"http", "https"} if local else {"https"}), "A valid production public gate origin is required")
    key = getattr(settings, "GATE_ID_ENCRYPTION_KEY", "") or os.getenv("GATE_ID_ENCRYPTION_KEY", "")
    require(bool(key), "Optional government ID encryption must be configured")
    Fernet(key.encode())
    logging.getLogger("django.request").setLevel(logging.CRITICAL)
    logging.getLogger("apps.users.middleware").setLevel(logging.CRITICAL)
    logging.getLogger("apps.analytics.views").setLevel(logging.CRITICAL)
    logging.getLogger("config.views").setLevel(logging.CRITICAL)
    # No settings change escapes this process. This deliberately tests the
    # watchman ceiling even with legacy non-strict RBAC and stale owner/extras.
    checks, users, objects, tokens, assignments, roles = [], [], [], [], [], []
    nonce = secrets.token_hex(8)
    client_defaults = {"HTTP_HOST": origin.netloc, "wsgi.url_scheme": origin.scheme, "HTTP_ORIGIN": f"{origin.scheme}://{origin.netloc}", "REMOTE_ADDR": f"2001:db8:{nonce[:4]}:{nonce[4:8]}:{nonce[8:12]}:{nonce[12:]}::1"}

    def new_token():
        value = str(uuid.uuid4())
        tokens.append(value)
        return value

    def authenticated(user, cookie=False):
        client = RollbackAPIClient(enforce_csrf_checks=True, **client_defaults)
        signed = str(AccessToken.for_user(user))
        if cookie:
            client.cookies[settings.JWT_ACCESS_COOKIE_NAME] = signed
        else:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {signed}")
        return client

    def new_user(label, role, extras=None, owner=False, superuser=False):
        account = User(username=f"release_gate_{label}_{nonce}", role=role, is_owner=owner, is_superuser=superuser, extra_permissions=extras or [])
        account.set_unusable_password()
        account.save()
        users.append(account.id)
        return account

    # Restrict every SQL mutation to the specific feature/auth tables required
    # for this test. This guards stock, accounting and master tables before a
    # mutation can run, even if a later application change violates the contract.
    allowed_writes = {model._meta.db_table for model in apps.get_app_config("gate").get_models()}
    allowed_writes.update(model._meta.db_table for model in (User, Role, PermissionAuditLog))
    mutation_patterns = [r'^\s*INSERT\s+INTO\s+"?([a-zA-Z0-9_]+)"?', r'^\s*UPDATE\s+"?([a-zA-Z0-9_]+)"?', r'^\s*DELETE\s+FROM\s+"?([a-zA-Z0-9_]+)"?']

    def sql_guard(execute, sql, params, many, context):
        for pattern in mutation_patterns:
            match = re.match(pattern, sql, re.IGNORECASE)
            if match:
                require(match.group(1) in allowed_writes, "Acceptance attempted a mutation outside gate/auth tables")
                break
        else:
            require(not re.match(r'^\s*(ALTER|CREATE|DROP|TRUNCATE|COPY|MERGE|WITH)\b', sql, re.IGNORECASE), "Acceptance attempted an unreviewed SQL mutation")
        return execute(sql, params, many, context)

    with transaction.atomic(), connection.execute_wrapper(sql_guard), override_settings(STRICT_RBAC=False, ALLOW_ROLE_OVERRIDE=False):
        try:
            # A repeatable snapshot excludes concurrent real factory changes
            # from before/after hashes; our own writes remain visible. Budgets
            # prevent this short acceptance from waiting on busy factory rows.
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                cursor.execute("SET LOCAL statement_timeout='10000ms'")
                cursor.execute("SET LOCAL lock_timeout='1000ms'")
            actual_tables = set(connection.introspection.table_names())
            protected = {model._meta.db_table: model._meta.pk.column for label in ("inventory", "sales", "procurement", "production", "materials", "factory") for model in apps.get_app_config(label).get_models(include_auto_created=True) if model._meta.db_table in actual_tables}
            before = business_snapshot(protected)
            require(len(before) >= 20, "The ERP invariant snapshot is incomplete")
            plants = list(Plant.objects.order_by("id")[:2])
            require(len(plants) == 2, "Two existing plants are required for actual plant scope acceptance")
            plant, other = plants
            link = GatePublicLink.objects.filter(plant=plant, active=True).first()
            require(link is not None, "Existing factory public QR link is missing")
            owner_role, watch_role = Role.objects.filter(code="OWNER").first(), Role.objects.filter(code="WATCHMAN").first()
            require(owner_role is not None and watch_role is not None, "Required migrated roles are missing")
            admin_role = Role.objects.filter(code="ADMIN").first()
            require(admin_role is not None, "Existing administrator role is missing")
            super_admin_role, created = Role.objects.get_or_create(code="SUPER_ADMIN", defaults={"name": "Temporary rollback-only Admin alias", "default_permissions": []})
            if created:
                roles.append(super_admin_role.id)
            restricted_role = Role.objects.create(code=f"GATE_ACCEPT_{nonce}", name="Temporary rollback-only acceptance", default_permissions=[])
            roles.append(restricted_role.id)
            owner_user = new_user("owner", owner_role, owner=True)
            admin_user = new_user("admin", admin_role)
            super_admin_user = new_user("super_admin", super_admin_role)
            owner_flag_user = new_user("owner_flag", restricted_role, owner=True)
            superuser_flag_user = new_user("superuser_flag", restricted_role, superuser=True)
            watch_user = new_user("watchman", watch_role)
            delegate_user = new_user("reports", restricted_role, extras=["gate.reports"])
            unassigned_user = new_user("unassigned", watch_role)
            plain_user = new_user("plain", restricted_role)
            assignment = GateAssignment.objects.create(user=watch_user, plant=plant)
            assignments.append(assignment.id)
            owner, watch, delegate, unassigned, plain = [authenticated(user) for user in (owner_user, watch_user, delegate_user, unassigned_user, plain_user)]
            admin, super_admin, owner_flag, superuser_flag = [authenticated(user) for user in (admin_user, super_admin_user, owner_flag_user, superuser_flag_user)]
            master_clients = (owner, admin, authenticated(admin_user, cookie=True), super_admin, owner_flag, superuser_flag)
            cookie = authenticated(watch_user, cookie=True)
            masters = api(watch.get("/api/gate/masters/", {"plant": str(plant.id)}), 200, "Assigned watchman gate access")
            require(masters.get("X-App-Build") == expected_sha, "Authenticated response build identity differs")
            require({item["id"] for item in masters.json()["plants"]} == {str(plant.id)}, "Watchman plant list escapes assignment")
            api(watch.get("/api/gate/masters/", {"plant": str(other.id)}), 403, "Other plant denied")
            api(unassigned.get("/api/gate/masters/"), 403, "Unassigned watchman denied")
            api(plain.get("/api/gate/visitors/"), 403, "Unprivileged visitor access denied")
            require(not admin_user.is_owner and not admin_user.is_superuser, "Actual administrator fixture must not carry privileged flags")
            for master in master_clients:
                account = api(master.get("/api/users/me/"), 200, "Master own account entitlements").json()
                require(account["entitlements"]["gate_master"], "Actual administrator/owner master entitlement is missing")
                available = api(master.get("/api/gate/masters/"), 200, "Unassigned master all-factory access").json()
                require({str(plant.id), str(other.id)} <= {item["id"] for item in available["plants"]}, "Master gate access is restricted by watchman assignments")
                for route in ("/api/gate/visitors/", "/api/gate/audit/", "/api/gate/reports/", "/api/analytics/reports/gate/"):
                    api(master.get(route), 200, "Default master gate/history/report access")
                api(master.get("/api/gate/qr/", {"plant": str(other.id)}), 200, "Master cross-factory QR access")
            # This GET normally auto-provisions unrelated report defaults.
            # Suppress only that provisioning; JWT/view authorization and
            # existing-profile serialization remain real, with the SQL mutation
            # allowlist unchanged and no manual report generation or delivery.
            with patch("apps.analytics.report_delivery.ReportDistributionService.ensure_defaults", return_value=[]):
                for master in master_clients:
                    profiles = api(master.get("/api/analytics/report-distributions/"), 200, "Default master report configuration read").json()["profiles"]
                    gate_profile = next((profile for profile in profiles if profile["report_code"] == "gate_register_daily"), None)
                    require(gate_profile is not None and gate_profile["target_roles"] == ["OWNER"], "Master configuration is missing or report recipients expanded")
            for limited in (delegate, plain, watch, cookie):
                api(limited.get("/api/analytics/report-distributions/"), 403, "Non-master report configuration denied")
                api(limited.post("/api/analytics/report-distributions/gate_register_daily/send/", {}, format="json"), 403, "Non-master report generation denied")
            for client in (watch, cookie):
                for route in ("/api/sales/orders/", "/api/inventory/materials/", "/api/procurement/purchase-orders/", "/api/analytics/dashboard/", "/api/users/users/", "/api/factory/plants/", "/api/platformops/backup-status/"):
                    api(client.get(route), 403, "Watchman ERP ceiling")
                api(client.get("/api/users/me/"), 200, "Watchman own account")
                for route in ("/api/gate/audit/", "/api/gate/reports/", "/api/gate/qr/", "/api/analytics/reports/gate/"):
                    api(client.get(route), 403, "Watchman owner/report ceiling")
            watch_user.is_owner, watch_user.is_superuser, watch_user.extra_permissions = True, True, ["*", "gate.reports", "gate.view"]
            watch_user.save(update_fields=["is_owner", "is_superuser", "extra_permissions"])
            for route in ("/api/sales/orders/", "/api/gate/audit/", "/api/gate/reports/"):
                api(watch.get(route, HTTP_X_ROLE_OVERRIDE="OWNER"), 403, "Stale owner/superuser/extra permission escalation denied")
            with override_settings(ALLOW_ROLE_OVERRIDE=True):
                for preview in ("OWNER", "SALES"):
                    api(admin.get("/api/gate/visitors/", HTTP_X_ROLE_OVERRIDE=preview), 200, "Actual administrator retains master rights in non-watchman preview")
                    require(api(admin.get("/api/users/me/", HTTP_X_ROLE_OVERRIDE=preview), 200, "Administrator preview entitlements").json()["entitlements"]["gate_master"], "Administrator preview lost actual master rights")
                for master in (admin, owner, superuser_flag):
                    for route in ("/api/gate/audit/", "/api/gate/reports/", "/api/analytics/reports/gate/", "/api/inventory/materials/"):
                        api(master.get(route, HTTP_X_ROLE_OVERRIDE="WATCHMAN"), 403, "Effective watchman ceiling wins over master role or flags")
                    require(not api(master.get("/api/users/me/", HTTP_X_ROLE_OVERRIDE="WATCHMAN"), 200, "Watchman preview entitlements").json()["entitlements"]["gate_master"], "Watchman preview exposes master entitlement")
                api(watch.get("/api/gate/audit/", HTTP_X_ROLE_OVERRIDE="ADMIN"), 403, "Actual watchman ceiling wins over admin preview and stale flags")
            checks.append("real JWT bearer/cookie; ADMIN/SUPER_ADMIN/owner/privileged-flag master defaults; actual/effective watchman ceiling; sanitized delegate and configuration/send guards")

            public = RollbackAPIClient(enforce_csrf_checks=True, **client_defaults)
            before_visit = api(watch.get("/api/gate/summary/", {"plant": str(plant.id)}), 200, "Visitor counters before registration").json()
            cfg = api(public.get("/api/gate/public/config/", {"gate_token": str(link.token)}), 200, "Public UUID configuration")
            require(cfg.get("Cache-Control") == "no-store" and "plant" not in cfg.json(), "Public configuration leaks identity or cache policy")
            require(set(cfg.json()) <= {"company_name", "plant_name", "plant_code", "purposes", "privacy_note", "government_id_enabled"}, "Public configuration exposes extra fields")
            api(public.get("/api/gate/public/config/", {"plant_code": plant.code}), 404, "Opaque UUID authority required")
            api(public.get("/api/gate/public/visitors/"), 405, "No public listing")
            require(public.get("/api/gate/visitors/").status_code in {401, 403}, "Anonymous visitor data denied")
            mobile = "9" + f"{secrets.randbelow(1_000_000_000):09d}"
            name, government_id = f"Release acceptance {nonce}", "ABCDE1234F"
            photo = io.BytesIO()
            exif = Image.Exif()
            exif[271] = "synthetic-private-camera-metadata"
            Image.new("RGB", (1200, 900), "#8a9f80").save(photo, "JPEG", exif=exif)
            payload = {"client_token": new_token(), "gate_token": str(link.token), "plant": str(other.id), "name": name, "mobile": mobile, "purpose": "Meeting", "company": "Rollback-only release acceptance", "government_id_type": "PAN", "government_id_number": government_id, "consent": True}

            def multipart():
                return {**payload, "selfie": SimpleUploadedFile("synthetic.jpg", photo.getvalue(), content_type="image/jpeg")}

            receipt = api(public.post("/api/gate/public/visitors/", multipart(), format="multipart"), 201, "Public immediate entry registration").json()
            require(set(receipt) == {"receipt_id", "status", "entry_at", "message", "replayed"} and receipt["status"] == "INSIDE", "Public submission leaks fields or fails to record entry")
            visitor_id = receipt["receipt_id"]
            objects.append(visitor_id)
            row = VisitorVisit.objects.get(id=visitor_id)
            require(row.plant_id == plant.id, "Public caller substituted factory scope")
            require(row.status == "INSIDE" and row.entry_at == row.submitted_at == row.consent_at and row.exit_at is None and row.entry_by_id is None, "Public entry must be recorded immediately without watchman admission")
            original_entry_at = row.entry_at
            require(datetime.fromisoformat(receipt["entry_at"]) == original_entry_at, "Public receipt entry timestamp differs from the recorded entry")
            initial_events = list(GateAuditEvent.objects.filter(object_id=visitor_id).order_by("created_at").values_list("action", "actor_id"))
            require(initial_events == [("VISITOR_REGISTERED", None), ("VISITOR_ENTERED", None)], "Public submission did not record one registration and one entry audit without an actor")
            entry_summary = api(watch.get("/api/gate/summary/", {"plant": str(plant.id)}), 200, "Immediate visitor entry counters").json()
            require(entry_summary["inside_visitors"] == before_visit["inside_visitors"] + 1 and entry_summary["visitor_entries"] == before_visit["visitor_entries"] + 1 and entry_summary["pending_visitors"] == before_visit["pending_visitors"], "Public registration did not count immediate entry/inside")
            require(government_id not in row.government_id_encrypted and Fernet(key.encode()).decrypt(row.government_id_encrypted.encode()).decode() == government_id, "Government ID encryption failed")
            image = Image.open(io.BytesIO(bytes(row.selfie_data)))
            require(image.format == "JPEG" and max(image.size) <= 640 and not image.getexif(), "Selfie sanitization failed")
            replay = api(public.post("/api/gate/public/visitors/", multipart(), format="multipart"), 201, "Public retry").json()
            require(replay["receipt_id"] == visitor_id and replay["entry_at"] == receipt["entry_at"] and replay["replayed"], "Public retry duplicated visitor or changed its entry timestamp")
            api(public.post("/api/gate/public/visitors/", {**payload, "company": "Changed retry"}, format="json"), 409, "Changed retry rejected")
            api(public.post("/api/gate/public/visitors/", {**payload, "client_token": new_token()}, format="json"), 409, "Duplicate active mobile rejected")
            row.refresh_from_db()
            require(row.entry_at == original_entry_at and GateAuditEvent.objects.filter(object_id=visitor_id, action="VISITOR_ENTERED").count() == 1, "Registration retry changed entry time or duplicated entry audit")
            for route in (f"/api/gate/public/visitors/{visitor_id}/", f"/api/gate/public/visitors/{visitor_id}/selfie/"):
                api(public.get(route), 404, "No public receipt/image route")
            require(public.get(f"/api/gate/visitors/{visitor_id}/selfie/").status_code in {401, 403}, "Anonymous selfie denied")
            api(delegate.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 403, "Reports permission grants no selfie")
            selfie = api(watch.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 200, "Active watchman selfie")
            require(selfie.get("Cache-Control") == "private, no-store" and selfie.get("Content-Type") == "image/jpeg", "Private selfie headers missing")
            checks.append("public immediate entry via opaque QR; one entry timestamp/audit; encrypted IDs; private sanitized selfie; replay/duplicate rejection")

            walkin = {"client_token": new_token(), "plant": str(plant.id), "name": f"Denied walk-in {nonce}", "mobile": "7" + f"{secrets.randbelow(1_000_000_000):09d}", "purpose": "Meeting", "consent": True}
            api(watch.post("/api/gate/visitors/", walkin, format="json"), 403, "Watchman walk-in creation denied")
            for client in (watch, cookie):
                api(client.post(f"/api/gate/visitors/{visitor_id}/check-in/", {"client_token": new_token()}, format="json"), 403, "Watchman admission denied")
                api(client.post(f"/api/gate/visitors/{visitor_id}/cancel/", {"client_token": new_token(), "reason": "Visit cancelled"}, format="json"), 403, "Watchman cancellation denied")
            exit_action = {"client_token": new_token()}
            api(cookie.post(f"/api/gate/visitors/{visitor_id}/check-out/", exit_action, format="json"), 403, "Unsafe cookie exit needs CSRF")
            csrf = api(cookie.get("/api/users/csrf/"), 200, "Cookie CSRF bootstrap").json()["csrfToken"]
            cookie.credentials(HTTP_X_CSRFTOKEN=csrf)
            exited = api(cookie.post(f"/api/gate/visitors/{visitor_id}/check-out/", exit_action, format="json"), 200, "CSRF-authenticated physical exit").json()
            require(exited["status"] == "EXITED", "Exit did not transition visitor")
            require(api(watch.post(f"/api/gate/visitors/{visitor_id}/check-out/", exit_action, format="json"), 200, "Exit retry").json()["replayed"], "Exit retry did not replay")
            api(watch.post(f"/api/gate/visitors/{visitor_id}/check-out/", {"client_token": new_token()}, format="json"), 409, "Second physical exit rejected")
            row.refresh_from_db()
            require(row.status == "EXITED" and row.entry_at == original_entry_at and row.entry_at <= row.exit_at, "Lifecycle status/time invariant failed")
            require(GateAuditEvent.objects.filter(object_id=visitor_id, action="VISITOR_ENTERED").count() == 1 and GateAuditEvent.objects.filter(object_id=visitor_id, action="VISITOR_EXITED").count() == 1, "Repeated lifecycle duplicated audit")
            exit_summary = api(watch.get("/api/gate/summary/", {"plant": str(plant.id)}), 200, "Visitor exit counters").json()
            require(exit_summary["inside_visitors"] == before_visit["inside_visitors"] and exit_summary["visitor_entries"] == before_visit["visitor_entries"] + 1 and exit_summary["visitor_exits"] == before_visit["visitor_exits"] + 1, "Exit counters or repeated entry totals are incorrect")
            legacy_payload = {"client_token": new_token(), "plant": str(plant.id), "name": f"Owner recovery {nonce}", "mobile": "6" + f"{secrets.randbelow(1_000_000_000):09d}", "purpose": "Meeting", "consent": True, "selfie": SimpleUploadedFile("recovery.jpg", photo.getvalue(), content_type="image/jpeg")}
            legacy = api(admin.post("/api/gate/visitors/", legacy_payload, format="multipart"), 201, "Administrator pending recovery").json()
            objects.append(legacy["id"])
            require(legacy["status"] == "PENDING" and legacy["source"] == "OWNER", "Owner recovery did not retain explicit pending provenance")
            api(watch.get("/api/gate/visitors/", {"status": "PENDING"}), 403, "Legacy pending queue owner only")
            active_queue = api(watch.get("/api/gate/visitors/", {"search": nonce}), 200, "Watchman inside-only queue").json()
            require(legacy["id"] not in {item["id"] for item in active_queue["results"]} and all(item["status"] == "INSIDE" for item in active_queue["results"]), "Watchman queue includes pending or closed visits")
            api(watch.get(f"/api/gate/visitors/{legacy['id']}/selfie/"), 404, "Legacy pending selfie owner only")
            for action, data in (("check-in", {"client_token": new_token()}), ("cancel", {"client_token": new_token(), "reason": "Visit cancelled"})):
                api(watch.post(f"/api/gate/visitors/{legacy['id']}/{action}/", data, format="json"), 403, "Watchman cannot operate legacy pending recovery")
            api(watch.post(f"/api/gate/visitors/{legacy['id']}/check-out/", {"client_token": new_token()}, format="json"), 409, "Legacy pending cannot exit before owner recovery")
            api(admin.post(f"/api/gate/visitors/{legacy['id']}/check-in/", {"client_token": new_token()}, format="json"), 200, "Administrator pending recovery admission")
            api(watch.post(f"/api/gate/visitors/{legacy['id']}/check-out/", {"client_token": new_token()}, format="json"), 200, "Watchman exits recovered inside visit")
            api(watch.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 404, "Closed visitor selfie denied to watchman")
            api(watch.get("/api/gate/visitors/", {"status": "EXITED"}), 403, "Closed history denied to watchman")
            api(owner.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 200, "Owner closed selfie")
            closed = api(owner.get("/api/gate/visitors/", {"status": "EXITED", "search": nonce}), 200, "Owner full history").json()
            require(visitor_id in {item["id"] for item in closed["results"]}, "Owner history omits observation")
            for master in master_clients:
                api(master.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 200, "Master private closed visitor photo")
                history = api(master.get("/api/gate/visitors/", {"status": "EXITED", "search": nonce}), 200, "Master complete visitor history").json()
                require(visitor_id in {item["id"] for item in history["results"]} and government_id not in json.dumps(history), "Master history is missing or exposes raw government ID")
            other_payload = {"client_token": new_token(), "plant": str(other.id), "name": f"Other scope {nonce}", "mobile": "8" + f"{secrets.randbelow(1_000_000_000):09d}", "purpose": "Meeting", "consent": True}
            other_visitor = api(owner.post("/api/gate/visitors/", other_payload, format="json"), 201, "Owner second-factory pending visitor").json()["id"]
            objects.append(other_visitor)
            api(watch.post(f"/api/gate/visitors/{other_visitor}/check-out/", {"client_token": new_token()}, format="json"), 404, "Other-factory exit denied")
            api(owner.post(f"/api/gate/visitors/{other_visitor}/cancel/", {"client_token": new_token(), "reason": "Visit cancelled"}, format="json"), 200, "Pending cancellation")
            require(VisitorVisit.objects.get(id=other_visitor).entry_at is None, "Cancellation invented physical entry")
            audit = api(owner.get("/api/gate/audit/", {"object_id": visitor_id}), 200, "Owner immutable audit")
            require(all(value not in body(audit) for value in (government_id, mobile, name, "government_id_encrypted", "selfie_data")), "Audit exposes sensitive visitor fields")
            event = GateAuditEvent.objects.filter(object_id=visitor_id).first()
            table = connection.ops.quote_name(GateAuditEvent._meta.db_table)
            for sql in (f"UPDATE {table} SET reason='synthetic attempted tamper' WHERE id=%s", f"DELETE FROM {table} WHERE id=%s"):
                rejected = False
                try:
                    with transaction.atomic(), connection.cursor() as cursor:
                        cursor.execute(sql, [event.id])
                except DatabaseError:
                    rejected = True
                require(rejected, "PostgreSQL audit mutation guard is missing")
            checks.append("watchman exit only; creation/admission/cancellation denied; cookie CSRF and bearer retry; owner history; immutable safe audit")

            master_data = masters.json()
            require(bool(master_data["parties"]) and bool(master_data["products"]), "Existing active party/product masters are required")
            party, product = master_data["parties"][0], master_data["products"][0]
            invoice = f"=RELEASE-{nonce}"
            goods_payload = {"client_token": new_token(), "plant": str(plant.id), "direction": "INWARD" if party["kind"] == "VENDOR" else "OUTWARD", "invoice_number": invoice, "vehicle_number": "QA00AA0001", "party_kind": party["kind"], "party_id": party["id"], "lines": [{"product_kind": product["kind"], "product_id": product["id"], "quantity": "1", "uom": product["uom"]}]}
            goods = api(cookie.post("/api/gate/goods/", goods_payload, format="json"), 201, "Master-selected observed goods").json()
            goods_id = goods["id"]
            objects.append(goods_id)
            require(goods["reconciliation_status"] == "UNMATCHED" and goods["amount"] is None, "Unmatched observation invents financial amount")
            repeated = api(watch.post("/api/gate/goods/", goods_payload, format="json"), 201, "Goods retry").json()
            require(repeated["id"] == goods_id and repeated["replayed"], "Goods retry duplicated movement")
            api(watch.post("/api/gate/goods/", {**goods_payload, "client_token": new_token()}, format="json"), 409, "Duplicate invoice rejected")
            api(watch.post("/api/gate/goods/", {**goods_payload, "plant": str(other.id), "client_token": new_token()}, format="json"), 403, "Other-plant goods write denied")
            api(watch.get(f"/api/gate/goods/{goods_id}/"), 403, "Owner detail ceiling")
            correction = {"client_token": new_token(), "reason": "Rollback-only release verification", "vehicle_number": "QA00AA0002"}
            api(watch.post(f"/api/gate/goods/{goods_id}/correct/", correction, format="json"), 403, "Watchman correction denied")
            corrected = api(owner.post(f"/api/gate/goods/{goods_id}/correct/", correction, format="json"), 200, "Owner reasoned correction").json()
            require(corrected["vehicle_number"] == "QA00AA0002" and GateAuditEvent.objects.filter(object_id=goods_id, action="GOODS_CORRECTED").exists(), "Owner correction lacks retained audit")
            api(admin.get(f"/api/gate/goods/{goods_id}/"), 200, "Administrator private goods detail")
            admin_correction = {"client_token": new_token(), "reason": "Rollback-only administrator verification", "vehicle_number": "QA00AA0003"}
            require(api(admin.post(f"/api/gate/goods/{goods_id}/correct/", admin_correction, format="json"), 200, "Administrator audited correction").json()["vehicle_number"] == "QA00AA0003", "Administrator correction failed")
            for route in ("/api/gate/visitors/", "/api/gate/audit/", f"/api/gate/goods/{goods_id}/"):
                api(delegate.get(route), 403, "Report delegate personal/history ceiling")
            for route in ("/api/gate/reports/", "/api/analytics/reports/gate/"):
                report = api(delegate.get(route, {"plant": str(plant.id)}), 200, "Explicit sanitized report permission")
                require(all(value not in body(report) for value in (government_id, mobile, name, "selfie_data", "government_id_encrypted")), "Delegated reports expose sensitive visitor data")
                api(plain.get(route), 403, "No report permission denied")
            api(delegate.get("/api/gate/reports/", {"plant": str(other.id)}), 200, "Sanitized report delegation across factories")
            exported = api(delegate.get("/api/gate/reports/csv/", {"plant": str(plant.id)}), 200, "Sanitized CSV")
            csv_rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"))))
            require(any(item["invoice_number"] == "'" + invoice for item in csv_rows), "CSV formula escaping failed")
            qr = api(owner.get("/api/gate/qr/", {"plant": str(plant.id)}), 200, "Owner QR authority").json()
            require(qr["gate_token"] == str(link.token) and qr["public_url"].endswith(f"/visit/{link.token}"), "QR targets wrong public flow")
            require(api(owner.get(qr["svg_url"]), 200, "Actual QR SVG").get("Content-Type") == "image/svg+xml", "QR image is missing")
            checks.append("master-selected gate observations; duplicates; owner correction; sanitized reports/CSV entitlement; QR")

            prior = gate_today() - timedelta(days=1)
            GoodsMovement.objects.filter(id=goods_id).update(logged_at=row.submitted_at - timedelta(days=1))
            api(watch.get("/api/gate/goods/", {"date_from": str(prior), "date_to": str(prior)}), 403, "Watchman historical goods denied")
            history = api(owner.get("/api/gate/goods/", {"search": nonce}), 200, "Owner full goods history").json()
            require(goods_id in {item["id"] for item in history["results"]}, "Owner goods history missing")
            require(business_snapshot(protected) == before, "A gate action modified protected ERP business/master rows")
            checks.append(f"full-row SQL invariants unchanged across {len(protected)} ERP/master tables; SQL mutation allowlist")
            # Track only our fresh address's rate buckets for post-rollback proof.
            import hmac
            address_digest = hmac.new(settings.SECRET_KEY.encode(), client_defaults["REMOTE_ADDR"].encode(), hashlib.sha256).hexdigest()
            rate_keys = list(GatePublicRateBucket.objects.filter(key__contains=address_digest).values_list("key", flat=True))
            require(bool(rate_keys), "Public DB throttle was bypassed")
        finally:
            transaction.set_rollback(True)

    # Assertions after the outer transaction has ended prove no synthetic rows
    # escaped through a separate connection or an early commit.
    require(not User.objects.filter(id__in=users).exists() and not Role.objects.filter(id__in=roles).exists(), "Temporary authentication records persisted")
    require(not GateAssignment.objects.filter(id__in=assignments).exists(), "Temporary assignments persisted")
    require(not GoodsMovement.objects.filter(id__in=objects).exists() and not GoodsLine.objects.filter(movement_id__in=objects).exists() and not VisitorVisit.objects.filter(id__in=objects).exists(), "Temporary physical observations persisted")
    require(not GateAuditEvent.objects.filter(object_id__in=objects).exists() and not GateRequestReceipt.objects.filter(token__in=tokens).exists(), "Temporary gate audit/receipt rows persisted")
    require(not PermissionAuditLog.objects.filter(user_id__in=users).exists(), "Temporary permission audit persisted")
    require(not GatePublicRateBucket.objects.filter(key__in=rate_keys).exists(), "Temporary public throttle rows persisted")
    checks.append("outer rollback verified: zero persistent synthetic users, assignments, visitors, goods, audit, receipts or rate buckets")
    return {"status": "PASS", "expected_build_sha": expected_sha, "mode": "isolated-local" if local else "deployed-production", "checks": checks, "synthetic_records_persisted": False, "existing_passwords_changed": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--local", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(main(args.expected_sha, args.local)))
    except Exception as error:
        # Safe diagnostics only: never print a response body, SQL parameters,
        # credentials, government IDs, users or private factory master values.
        detail = str(error) if isinstance(error, AcceptanceFailure) else "Acceptance encountered an unexpected error; all transactional work was rolled back"
        print(json.dumps({"status": "FAIL", "check": detail, "error_type": type(error).__name__}))
        raise SystemExit(1)
