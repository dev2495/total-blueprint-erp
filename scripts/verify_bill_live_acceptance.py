"""Signed, rollback-only bill API acceptance without locking real plant records.

Production requires the exact expected image SHA. --local is restricted to the
isolated bill development database. UUID-only plants/locations and one direct
receipt fixture live in a nested savepoint that is always rolled back; neither
stock services nor document numbering are invoked. Full ERP/auth/notification
row snapshots in the same repeatable-read transaction must match afterward.
"""
import argparse
import hashlib
import io
import json
import logging
import os
import re
import secrets
import sys
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()
from PIL import Image, ImageDraw
from django.apps import apps
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, models, transaction
from django.test import override_settings
from rest_framework_simplejwt.tokens import AccessToken
from apps.factory.models import Plant
from apps.gate.models import GateAssignment, GateAuditEvent, GatePublicLink, GateRequestReceipt, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
from apps.inventory.models import BulkTransaction, InventoryLocation, InventoryMaterial, Vendor
from apps.users.models import Notification, NotificationDeliveryAttempt, PermissionAuditLog, Role, User
from verify_gate_live_acceptance import AcceptanceFailure, RollbackAPIClient, business_snapshot, require


BASE = "/api/gate/inward-bills/"
SUMMARY = "/api/users/notifications/inward-bill-summary/"


def checked(response, status, label):
    require(response.status_code == status, f"{label}: expected HTTP {status}, received HTTP {response.status_code}")
    return response


def main(expected, local, production_shaped_local=False):
    require(bool(re.fullmatch(r"[0-9a-f]{40}", expected)) and os.getenv("APP_BUILD_SHA") == expected, "Exact expected image SHA is required")
    require(connection.vendor == "postgresql", "Acceptance requires PostgreSQL immutable evidence guards")
    if local or production_shaped_local:
        require(os.getenv("BILL_ACCEPTANCE_ALLOW_LOCAL") == "1" and settings.DATABASES["default"]["NAME"] == "tpp_bill_dev_20261008", "Local acceptance is restricted to the explicitly isolated bill QA database")
        require((settings.IS_PRODUCTION and not settings.DEBUG) if production_shaped_local else settings.IS_LOCAL_DEV, "The isolated acceptance runtime mode differs from the requested mode")
    else:
        require(settings.IS_PRODUCTION and not settings.DEBUG, "Acceptance requires the deployed production backend")
    origin = urlparse(getattr(settings, "GATE_PUBLIC_ORIGIN", "") or os.getenv("GATE_PUBLIC_ORIGIN", ""))
    require(bool(origin.netloc) and origin.scheme in ({"http", "https"} if local else {"https"}), "A valid public origin is required")
    for name in ("django.request", "apps.users.middleware", "apps.analytics.views", "config.views"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    nonce = secrets.token_hex(7)
    checks, objects, account_ids, role_ids, receipt_ids, intake_ids = [], [], [], [], [], []
    defaults = {"HTTP_HOST": origin.netloc, "HTTP_ORIGIN": origin.scheme + "://" + origin.netloc, "wsgi.url_scheme": origin.scheme}
    allowed = {model._meta.db_table for model in (Plant, InventoryLocation, BulkTransaction, User, Role, PermissionAuditLog, Notification, NotificationDeliveryAttempt, GateAssignment, GatePublicLink, GateAuditEvent, GateRequestReceipt, InwardBillIntake, InwardBillPage, InwardBillReceiptReference)}
    require(all(isinstance(model._meta.pk, models.UUIDField) for model in (Plant, InventoryLocation, BulkTransaction, User, Role, Notification, NotificationDeliveryAttempt, GateAssignment, GatePublicLink, GateAuditEvent, GateRequestReceipt, InwardBillIntake, InwardBillPage, InwardBillReceiptReference)), "Acceptance fixtures must use UUID keys without document sequences")

    def sql_guard(execute, sql, params, many, context):
        require(not re.search(r"\b(nextval|setval)\s*\(", sql, re.IGNORECASE), "Acceptance attempted a nontransactional sequence operation")
        mutation = re.match(r'^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-zA-Z0-9_]+)"?', sql, re.IGNORECASE)
        if mutation:
            verb, table = mutation.groups()
            require(table in allowed, "Acceptance attempted a write outside its reviewed UUID fixture/feature tables")
            if table in {Plant._meta.db_table, InventoryLocation._meta.db_table, BulkTransaction._meta.db_table}:
                require(verb.upper().startswith("INSERT"), "Acceptance attempted to mutate an existing ERP row")
        else:
            require(not re.match(r"^\s*(ALTER|CREATE|DROP|TRUNCATE|COPY|MERGE|WITH)\b", sql, re.IGNORECASE), "Acceptance attempted an unreviewed SQL mutation")
        return execute(sql, params, many, context)

    def signed(account, cookie=False):
        client = RollbackAPIClient(enforce_csrf_checks=True, **defaults)
        token = str(AccessToken.for_user(account))
        if cookie:
            client.cookies[settings.JWT_ACCESS_COOKIE_NAME] = token
        else:
            client.credentials(HTTP_AUTHORIZATION="Bearer " + token)
        return client

    def token():
        return str(uuid.uuid4())

    def new_user(label, role, extra=None, owner=False, superuser=False):
        account = User(username="bill_accept_" + label + "_" + nonce, role=role, extra_permissions=extra or [], is_owner=owner, is_superuser=superuser)
        account.set_unusable_password()
        account.save()
        account_ids.append(account.id)
        return account

    def photo(changed=False):
        image = Image.new("RGB", (800, 600), "#f5f2e9" if not changed else "#e2eeed")
        ImageDraw.Draw(image).text((30, 30), "Synthetic release acceptance " + nonce, fill="#172d33")
        exif = Image.Exif()
        exif[270] = "Synthetic metadata must be removed"
        stream = io.BytesIO()
        image.save(stream, format="JPEG", quality=93, exif=exif)
        return SimpleUploadedFile("synthetic-bill.jpg", stream.getvalue(), content_type="image/jpeg")

    def upload(client, plant, request_token, changed=False):
        return client.post(BASE, {"plant": str(plant.id), "client_token": request_token, "images": [photo(changed)]}, format="multipart")

    with transaction.atomic(), connection.execute_wrapper(sql_guard), override_settings(STRICT_RBAC=False, ALLOW_ROLE_OVERRIDE=False):
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            cursor.execute("SET LOCAL statement_timeout='10000ms'")
            cursor.execute("SET LOCAL lock_timeout='1000ms'")
        tables = set(connection.introspection.table_names())
        protected = {model._meta.db_table: model._meta.pk.column for label in ("inventory", "sales", "procurement", "production", "materials", "factory", "users") for model in apps.get_app_config(label).get_models(include_auto_created=True) if model._meta.db_table in tables}
        before = business_snapshot(protected)
        require(len(before) >= 100, "The full ERP/auth invariant snapshot is incomplete")
        # Block generic broadcast/email/task dispatch. Real bill IN_APP inserts
        # and their delivery attempts remain exercised inside the savepoint.
        with transaction.atomic(), patch("apps.users.services.notification_service.NotificationService._queue_email_delivery", side_effect=AcceptanceFailure("External email fanout was attempted")), patch("celery.app.task.Task.apply_async", side_effect=AcceptanceFailure("External task fanout was attempted")):
            try:
                roles = {name: Role.objects.filter(code=name).first() for name in ("OWNER", "ADMIN", "STORE", "WATCHMAN", "SALES", "DISPATCH")}
                require(all(roles.values()), "Required existing canonical roles are missing")
                restricted = Role.objects.create(code="BILL_ACCEPT_" + nonce, name="Temporary rollback-only bill role", default_permissions=[])
                role_ids.append(restricted.id)
                accounts = {
                    "owner": new_user("owner", roles["OWNER"]), "admin": new_user("admin", roles["ADMIN"]),
                    "store": new_user("store", roles["STORE"]),
                    "reviewer": new_user("reviewer", restricted, ["gate.bill.review", "inventory.manage"]),
                    "watch": new_user("watch", roles["WATCHMAN"], ["*", "gate.bill.review", "inventory.manage"], owner=True, superuser=True),
                    "other_watch": new_user("other_watch", roles["WATCHMAN"]),
                    "unassigned": new_user("unassigned", roles["WATCHMAN"]),
                    "sales": new_user("sales", roles["SALES"], ["*"]),
                    "dispatch": new_user("dispatch", roles["DISPATCH"]),
                    "delegate": new_user("delegate", restricted, ["gate.reports"]),
                }
                clients = {name: signed(account) for name, account in accounts.items()}
                cookie = signed(accounts["watch"], cookie=True)
                anonymous = RollbackAPIClient(enforce_csrf_checks=True, **defaults)
                # These UUID-only plants never become visible to production
                # connections and do not hold locks on actual factory plants.
                plant = Plant.objects.create(code="BQA" + nonce[:10], name="Temporary bill acceptance " + nonce, include_in_official_reports=False)
                other = Plant.objects.create(code="BQB" + nonce[:10], name="Temporary second bill acceptance " + nonce, include_in_official_reports=False)
                objects.extend([plant.id, other.id])
                GateAssignment.objects.create(user=accounts["watch"], plant=plant)
                GateAssignment.objects.create(user=accounts["other_watch"], plant=other)
                for name in ("owner", "admin", "store", "reviewer"):
                    me = checked(clients[name].get("/api/users/me/"), 200, "Actual inventory reviewer entitlements").json()
                    require(me["entitlements"]["inventory_bill_review"], "An eligible actual account lost review authority")
                    checked(clients[name].get(SUMMARY, {"plant": str(plant.id)}), 200, "Actual inventory queue summary")
                for name in ("watch", "unassigned", "sales", "dispatch", "delegate"):
                    checked(clients[name].get(SUMMARY), 403, "Nonreviewer summary ceiling")
                require(anonymous.get(BASE).status_code in {401, 403}, "Public bill listing was exposed")
                checked(upload(cookie, plant, token()), 403, "Cookie upload requires CSRF")
                csrf = checked(cookie.get("/api/users/csrf/"), 200, "Normal cookie CSRF bootstrap").json()["csrfToken"]
                cookie.credentials(HTTP_X_CSRFTOKEN=csrf)
                checked(upload(clients["other_watch"], plant, token()), 403, "Other assigned gate cannot upload")
                checked(upload(clients["unassigned"], plant, token()), 403, "Unassigned watchman cannot upload")
                request_token = token()
                arrival = checked(upload(cookie, plant, request_token), 201, "Watchman camera upload").json()
                intake_ids.append(arrival["id"])
                require(arrival["status"] == "PENDING_GRN" and arrival["page_count"] == 1 and arrival["review_data"] == {} and arrival["receipt_refs"] == [], "Watchman upload inferred commercial data or stock")
                intake = InwardBillIntake.objects.get(pk=arrival["id"])
                require(arrival["arrival_at"] == intake.arrival_at.isoformat(), "Arrival receipt differs from persisted server time")
                page = intake.pages.get()
                with Image.open(io.BytesIO(bytes(page.data))) as normalized:
                    require(normalized.format == "JPEG" and not normalized.getexif() and max(normalized.size) <= 2400 and len(page.data) <= 2 * 1024**2, "Private bill normalization/caps/metadata stripping failed")
                page_url = arrival["pages"][0]["image_url"]
                image = checked(cookie.get(page_url), 200, "Creator private page")
                require("no-store" in image.get("Cache-Control", "") and image.get("X-Content-Type-Options") == "nosniff", "Private bill page caching/security headers failed")
                require(anonymous.get(page_url).status_code in {401, 403}, "Public bill image was exposed")
                for name in ("other_watch", "unassigned"):
                    checked(clients[name].get(BASE + arrival["id"] + "/"), 404, "Other watchman detail denied")
                    checked(clients[name].get(page_url), 404, "Other watchman image denied")
                for name in ("sales", "dispatch", "delegate"):
                    checked(clients[name].get(page_url), 403, "Nonreviewer image denied")
                notices = Notification.objects.filter(event_key="gate.inward_bill_uploaded", related_object_id=intake.id)
                notice_count = notices.count()
                require(notices.filter(user=accounts["store"]).count() == 1 and notices.filter(user=accounts["watch"]).count() == 0, "Arrival targeting bypassed actual reviewer authority")
                require(not notices.exclude(channels=["IN_APP"]).exists(), "A bill notification enabled external delivery")
                require(not NotificationDeliveryAttempt.objects.filter(notification__in=notices).exclude(channel="IN_APP", status="SUCCEEDED").exists(), "A bill notification scheduled external fanout")
                replay = checked(upload(cookie, plant, request_token), 201, "Uncertain upload retry").json()
                require(replay["id"] == arrival["id"] and replay["arrival_at"] == arrival["arrival_at"] and replay["replayed"] and notices.count() == notice_count and GateAuditEvent.objects.filter(object_id=intake.id, action="BILL_ARRIVED").count() == 1, "Upload retry duplicated arrival, audit or notifications")
                checked(upload(cookie, plant, request_token, changed=True), 409, "Changed upload retry rejected")
                checked(cookie.post("/api/gate/goods/", {"plant": str(plant.id), "direction": "INWARD", "client_token": token(), "invoice_number": "ACCEPT-IN-" + nonce, "vehicle_number": "QA00", "party_kind": "VENDOR", "party_id": token(), "lines": [{"product_kind": "MATERIAL", "product_id": token(), "quantity": "1.0000", "uom": "KG"}]}, format="json"), 403, "Schema-valid manual inward bypass denied before master/stock access")
                summary = checked(clients["store"].get(SUMMARY, {"plant": str(plant.id)}), 200, "Saved in-app pending summary").json()
                require(summary["pending_count"] == 1 and summary["unread_count"] == 1 and summary["poll_interval_seconds"] == 5, "In-app pending counts or poll contract failed")
                notification_rows = checked(clients["store"].get("/api/users/notifications/list/"), 200, "Persisted in-app delivery").json()
                notice = next(row for row in notification_rows if row["related_object_id"] == str(intake.id))
                require(notice["deep_link"] == "/inventory/gate-bills/" + str(intake.id) and notice["delivery_state"]["IN_APP"] == "DELIVERED" and "synthetic-bill.jpg" not in notice["message"], "Notification leaks image metadata or lacks its actual queue link")
                vendor = Vendor.objects.filter(status="ACTIVE").order_by("id").first()
                material = InventoryMaterial.objects.order_by("id").first()
                require(vendor is not None and material is not None, "Existing active vendor and inventory material masters are required")
                reviewed = {"client_token": token(), "vendor_id": str(vendor.id), "invoice_number": "ACCEPT-" + nonce, "notes": "Synthetic rollback-only review"}
                for name in ("watch", "sales", "delegate"):
                    checked(clients[name].post(BASE + str(intake.id) + "/review/", reviewed, format="json"), 403, "Unauthorized commercial review denied")
                checked(clients["store"].post(BASE + str(intake.id) + "/review/", reviewed, format="json"), 200, "Human inventory review")
                sanitized = checked(cookie.get(BASE + str(intake.id) + "/"), 200, "Watchman own reviewed arrival").json()
                require(sanitized["review_data"] == {} and sanitized["receipt_refs"] == [], "Inventory commercial review leaked into Watchman terminal")
                checked(clients["store"].post(BASE + str(intake.id) + "/complete/", {"client_token": token(), "reason": "No posted receipt exists yet"}, format="json"), 400, "No invented receipt completion")
                location = InventoryLocation.objects.filter(plant=plant, type="WAREHOUSE").get()
                receipt = BulkTransaction.objects.create(material=material, location=location, type="INWARD", qty_kg="1.0000", vendor=vendor, vendor_invoice_no=reviewed["invoice_number"], reference="Synthetic UUID receipt")
                receipt_ids.append(receipt.id)
                selected = checked(clients["store"].get(BASE + str(intake.id) + "/receipt-candidates/", {"search": reviewed["invoice_number"]}), 200, "Posted UUID receipt projection").json()
                require(selected["matching_is_manual"] and any(row["kind"] == "BULK" and row["id"] == str(receipt.id) for row in selected["results"]), "Manual candidate projection omitted the valid receipt")
                link_payload = {"client_token": token(), "receipt_refs": [{"kind": "BULK", "id": str(receipt.id)}], "reason": "Link synthetic posted receipt", "bill_complete": False}
                linked = checked(clients["store"].post(BASE + str(intake.id) + "/link-receipts/", link_payload, format="json"), 200, "Real API reference link").json()
                require(linked["status"] == "PARTIAL_GRN" and len(linked["receipt_refs"]) == 1, "Partial bill was closed without explicit inventory confirmation")
                require(checked(clients["store"].get(SUMMARY, {"plant": str(plant.id)}), 200, "Partial bill backlog").json()["pending_count"] == 1, "Partial receipt disappeared from inventory backlog")
                linked_replay = checked(clients["store"].post(BASE + str(intake.id) + "/link-receipts/", link_payload, format="json"), 200, "Receipt link retry").json()
                require(linked_replay["replayed"] and InwardBillReceiptReference.objects.filter(intake=intake).count() == 1, "Receipt retry duplicated evidence")
                completed = checked(clients["store"].post(BASE + str(intake.id) + "/complete/", {"client_token": token(), "reason": "Explicitly all synthetic bill lines received"}, format="json"), 200, "Explicit bill completion").json()
                require(completed["status"] == "RECEIPTED" and completed["resolved_at"], "Bill completion lacks lifecycle evidence")
                require(checked(clients["store"].get(SUMMARY, {"plant": str(plant.id)}), 200, "Resolved queue summary").json()["pending_count"] == 0, "Resolved bill remained in pending backlog")
                voided = checked(upload(clients["watch"], plant, token(), changed=True), 201, "Second independent arrival").json()
                intake_ids.append(voided["id"])
                checked(clients["store"].post(BASE + voided["id"] + "/void/", {"client_token": token(), "resolution_code": "NON_STOCK", "reason": "Synthetic service paperwork, no stock receipt"}, format="json"), 200, "Explained non-stock resolution")
                with override_settings(ALLOW_ROLE_OVERRIDE=True):
                    checked(clients["sales"].get(SUMMARY, HTTP_X_ROLE_OVERRIDE="STORE"), 403, "Role preview cannot grant actual receiving authority")
                    # STORE cannot activate a role preview; only eligible
                    # master accounts actually acquire effective WATCHMAN.
                    for name in ("admin", "owner"):
                        checked(clients[name].get(SUMMARY, HTTP_X_ROLE_OVERRIDE="WATCHMAN"), 403, "Effective Watchman review ceiling")
                    checked(clients["watch"].get(SUMMARY, HTTP_X_ROLE_OVERRIDE="ADMIN"), 403, "Actual stale-flag Watchman ceiling")
                with transaction.atomic():
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute("UPDATE " + connection.ops.quote_name(InwardBillPage._meta.db_table) + " SET byte_size=byte_size WHERE id=%s", [str(page.id)])
                    except DatabaseError:
                        transaction.set_rollback(True)
                    else:
                        raise AcceptanceFailure("PostgreSQL allowed mutation of immutable bill image evidence")
                checks.extend([
                    "real JWT bearer/cookie, CSRF; master and actual inventory authority; actual/effective Watchman ceiling and plant/creator scope",
                    "photo-only inward capture; private normalized JPEG; persisted server time; retry conflict, one audit/notification set",
                    "transaction-local IN_APP targeting and saved queue counts; no email/task fanout or image/commercial metadata in notices",
                    "human review, UUID-only receipt projection/link/partial/explicit completion and explained non-stock resolution; no stock service or document sequence",
                    "PostgreSQL image evidence immutability",
                ])
            finally:
                transaction.set_rollback(True)
        after = business_snapshot(protected)
        require(before == after, "ERP/master/auth/notification rows changed after the rollback savepoint")
        require(not Plant.objects.filter(pk__in=objects).exists() and not User.objects.filter(pk__in=account_ids).exists() and not Role.objects.filter(pk__in=role_ids).exists(), "Synthetic plants/accounts/roles persisted")
        require(not BulkTransaction.objects.filter(pk__in=receipt_ids).exists() and not InwardBillIntake.objects.filter(pk__in=intake_ids).exists() and not Notification.objects.filter(related_object_id__in=intake_ids).exists(), "Synthetic receipt/bill/notification records persisted")
        checks.append(f"full-row invariant snapshots unchanged across {len(protected)} ERP/master/auth tables; every UUID fixture and in-app notification rolled back")
        transaction.set_rollback(True)
    return {"status": "PASS", "expected_build_sha": expected, "mode": "production-shaped-local" if production_shaped_local else "isolated-local" if local else "deployed-production", "checks": checks, "synthetic_records_persisted": False, "existing_passwords_changed": False, "production_document_sequences_consumed": False, "real_plant_or_receipt_rows_locked": False, "external_notifications_emitted": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--local", action="store_true")
    mode.add_argument("--production-shaped-local", action="store_true")
    arguments = parser.parse_args()
    try:
        print(json.dumps(main(arguments.expected_sha, arguments.local, arguments.production_shaped_local), sort_keys=True))
    except Exception as error:
        detail = str(error) if isinstance(error, AcceptanceFailure) else "Acceptance encountered an unexpected error; its fixture savepoint was rolled back"
        print(json.dumps({"status": "FAIL", "check": detail}))
        raise SystemExit(1)
