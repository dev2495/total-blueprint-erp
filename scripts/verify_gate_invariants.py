"""Independent gate acceptance on synthetic local data with real JWT/CSRF auth.

Run after migrations and scripts/seed_gate_qa.py, with .runtime/gate-local.env
exported. This refuses every database except tpp_gate_dev_20261007. It records
new synthetic observations and retains their audit history; it never resets,
deletes, or imports factory business records. No credentials/IDs are printed.
"""
import csv
import hashlib
import io
import json
import os
import secrets
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

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
from django.db import DatabaseError, close_old_connections, connection, transaction
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient
from apps.gate.models import GateAssignment, GateAuditEvent, GateRequestReceipt, GoodsMovement, VisitorVisit
from apps.gate.services import gate_today
from apps.procurement.models import PurchaseOrderReceipt, PurchaseOrderReceiptLine


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def api(response, status, message):
    require(response.status_code == status, f"{message}: expected {status}, received {response.status_code}")
    return response


def body(response):
    return json.dumps(response.json(), sort_keys=True)


def token():
    return str(uuid.uuid4())


def login(fixture):
    """Authenticate using the product endpoint, including cookie CSRF checks."""
    cookie = APIClient(enforce_csrf_checks=True)
    csrf = api(cookie.get("/api/users/csrf/"), 200, "CSRF bootstrap").json()["csrfToken"]
    cookie.credentials(HTTP_X_CSRFTOKEN=csrf)
    api(cookie.post("/api/users/login/", {"username": fixture["username"], "password": fixture["password"]}, format="json"), 200, "Actual credential login")
    access = cookie.cookies[settings.JWT_ACCESS_COOKIE_NAME].value
    bearer = APIClient(enforce_csrf_checks=True)
    bearer.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return cookie, bearer, access


def business_snapshot():
    """Hash every actual row of protected ERP app tables, not only row counts."""
    tables = set(connection.introspection.table_names())
    result = {}
    for label in ["inventory", "sales", "procurement", "production"]:
        for model in apps.get_app_config(label).get_models(include_auto_created=True):
            table = model._meta.db_table
            if table not in tables or table in result:
                continue
            digest, count = hashlib.sha256(), 0
            quoted = connection.ops.quote_name(table)
            pk = connection.ops.quote_name(model._meta.pk.column)
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT to_jsonb(t)::text FROM {quoted} t ORDER BY {pk}")
                for row in cursor.fetchall():
                    digest.update(row[0].encode("utf-8"))
                    digest.update(b"\n")
                    count += 1
            result[table] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def race(access, path, payloads):
    barrier = threading.Barrier(len(payloads))
    def run(payload):
        close_old_connections()
        try:
            client = APIClient(enforce_csrf_checks=True)
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
            barrier.wait(timeout=10)
            response = client.post(path, payload, format="json")
            return response.status_code, response.json()
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
        return list(pool.map(run, payloads))


def main():
    require(settings.DATABASES["default"]["NAME"] == "tpp_gate_dev_20261007", "Refusing to run outside the isolated local gate QA database")
    fixtures = json.loads((BASE / ".runtime/gate-qa.json").read_text())
    nonce = secrets.token_hex(5)
    checks = []
    # Synthetic ERP references are created only before the invariant snapshot.
    original = PurchaseOrderReceipt.objects.get(id=fixtures["grn"])
    grn = PurchaseOrderReceipt.objects.create(code=f"GRN-INV-{nonce}", purchase_order=original.purchase_order, plant=original.plant, vendor_invoice_no=f"GATE-INV-{nonce}", vendor_invoice_date=gate_today(), vehicle_no=original.vehicle_no, quality_status="APPROVED")
    for line in original.lines.all():
        PurchaseOrderReceiptLine.objects.create(receipt=grn, po_item=line.po_item, qty_received=line.qty_received, rate=line.rate)
    mismatch_grn = PurchaseOrderReceipt.objects.create(code=f"GRN-MISMATCH-{nonce}", purchase_order=original.purchase_order, plant=original.plant, vendor_invoice_no=f"GATE-MATCH-{nonce}", vendor_invoice_date=gate_today(), vehicle_no=original.vehicle_no, quality_status="APPROVED")
    for line in original.lines.all():
        PurchaseOrderReceiptLine.objects.create(receipt=mismatch_grn, po_item=line.po_item, qty_received=line.qty_received, rate=line.rate)
    # An explicit report entitlement grants sanitized cross-factory reporting;
    # physical gate assignments separately restrict logging and personal data.
    before = business_snapshot()
    require(len(before) >= 20, "ERP invariant snapshot must cover meaningful business tables")
    with override_settings(STRICT_RBAC=False, ALLOW_ROLE_OVERRIDE=False):
        owner_cookie, owner, _ = login(fixtures["owner"])
        watch_cookie, watch, access = login(fixtures["watchman"])
        _, delegate, _ = login(fixtures["delegate"])
        _, sales, _ = login(fixtures["sales"])
        _, unassigned, _ = login(fixtures["unassigned"])
        for client in [watch_cookie, watch]:
            for route in ["/api/sales/orders/", "/api/inventory/materials/", "/api/procurement/purchase-orders/", "/api/analytics/dashboard/", "/api/users/users/", "/api/factory/plants/", "/api/platformops/backup-status/"]:
                api(client.get(route), 403, "Authenticated watchman ERP access ceiling")
            api(client.get("/api/users/me/"), 200, "Watchman own account remains usable")
            api(client.get("/api/gate/masters/", {"plant": fixtures["plant"]}), 200, "Assigned watchman gate access")
            api(client.get("/api/gate/masters/", {"plant": fixtures["other_plant"]}), 403, "Cross-plant watchman scope")
            api(client.get("/api/gate/audit/"), 403, "Watchman owner audit ceiling")
            api(client.get("/api/gate/reports/"), 403, "Watchman report ceiling")
        api(unassigned.get("/api/gate/masters/"), 403, "Unassigned watchman fail closed")
        api(sales.get("/api/gate/visitors/"), 403, "Unprivileged role gate ceiling")
        api(delegate.get("/api/gate/visitors/"), 403, "Report delegation grants no personal history")
        api(delegate.get("/api/gate/audit/"), 403, "Report delegation grants no audit")
        checks.append("real cookie/bearer auth, non-strict RBAC ceiling and plant scoping")

        public = APIClient(enforce_csrf_checks=True, REMOTE_ADDR=f"198.51.100.{secrets.randbelow(254) + 1}")
        cfg = api(public.get("/api/gate/public/config/", {"gate_token": fixtures["public_token"]}), 200, "Public QR configuration")
        require(set(cfg.json()) <= {"company_name", "plant_name", "plant_code", "purposes", "privacy_note", "government_id_enabled"}, "Public configuration leaks unexpected data")
        api(public.get("/api/gate/public/config/", {"plant_code": "GATE_QA_A"}), 404, "Plant code cannot replace opaque QR authority")
        api(public.get("/api/gate/public/visitors/"), 405, "No public visitor listing")
        require(public.get("/api/gate/visitors/").status_code in {401, 403}, "Anonymous private visitor access")
        mobile = "9" + f"{secrets.randbelow(1_000_000_000):09d}"
        visitor_name = f"Invariant Visitor {nonce}"
        government_id = "ABCDE1234F"  # Synthetic valid-shaped PAN; never printed.
        image = io.BytesIO()
        exif = Image.Exif()
        exif[271] = "synthetic-private-camera-metadata"
        Image.new("RGB", (1200, 900), "#73a1b5").save(image, "JPEG", exif=exif)
        payload = {"client_token": token(), "gate_token": fixtures["public_token"], "plant": fixtures["other_plant"], "name": visitor_name, "mobile": mobile, "purpose": "Meeting", "company": "Synthetic QA", "government_id_type": "PAN", "government_id_number": government_id, "consent": True}
        def multipart():
            return {**payload, "selfie": SimpleUploadedFile("qa.jpg", image.getvalue(), content_type="image/jpeg")}
        created = api(public.post("/api/gate/public/visitors/", multipart(), format="multipart"), 201, "Public pending registration")
        receipt = created.json()
        require(set(receipt) == {"receipt_id", "status", "message", "replayed"}, "Public registration leaks personal fields")
        require(receipt["status"] == "PENDING", "Public registration cannot admit visitor")
        visitor_id = receipt["receipt_id"]
        row = VisitorVisit.objects.get(id=visitor_id)
        require(str(row.plant_id) == fixtures["plant"], "Public caller cannot substitute plant")
        require(row.government_id_encrypted and government_id not in row.government_id_encrypted, "Government ID stored as plaintext")
        encryption_key = getattr(settings, "GATE_ID_ENCRYPTION_KEY", "") or os.environ["GATE_ID_ENCRYPTION_KEY"]
        require(Fernet(encryption_key.encode()).decrypt(row.government_id_encrypted.encode()).decode() == government_id, "Government ID encryption round trip")
        sanitized = Image.open(io.BytesIO(bytes(row.selfie_data)))
        require(sanitized.format == "JPEG" and max(sanitized.size) <= 640 and not sanitized.getexif(), "Selfie resize or metadata stripping failed")
        replay = api(public.post("/api/gate/public/visitors/", multipart(), format="multipart"), 201, "Public retry")
        require(replay.json()["receipt_id"] == visitor_id and replay.json()["replayed"], "Public retry created duplicate")
        api(public.post("/api/gate/public/visitors/", {**payload, "company": "Changed retry"}, format="json"), 409, "Changed retry token rejection")
        api(public.post("/api/gate/public/visitors/", {**payload, "client_token": token()}, format="json"), 409, "Duplicate active mobile rejection")
        for path in [f"/api/gate/public/visitors/{visitor_id}/", f"/api/gate/public/visitors/{visitor_id}/selfie/"]:
            api(public.get(path), 404, "No public receipt detail or image route")
        require(public.get(f"/api/gate/visitors/{visitor_id}/selfie/").status_code in {401, 403}, "Anonymous selfie access")
        photo = api(watch.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 200, "Active scoped selfie")
        require(photo["Cache-Control"] == "private, no-store" and photo["Content-Type"] == "image/jpeg", "Private selfie response headers")
        checks.append("opaque QR scope, no public data/photos, encrypted optional IDs, sanitized bounded selfie and replay")

        other_mobile = "8" + f"{secrets.randbelow(1_000_000_000):09d}"
        other = api(owner.post("/api/gate/visitors/", {"client_token": token(), "plant": fixtures["other_plant"], "name": f"Other Plant {nonce}", "mobile": other_mobile, "purpose": "Meeting", "consent": True}, format="json"), 201, "Other-plant synthetic visitor").json()
        api(watch.post(f"/api/gate/visitors/{other['id']}/check-in/", {"client_token": token()}, format="json"), 404, "Cross-plant action denial")
        api(watch.post(f"/api/gate/visitors/{visitor_id}/check-out/", {"client_token": token()}, format="json"), 409, "Exit before entry rejection")
        entered = race(access, f"/api/gate/visitors/{visitor_id}/check-in/", [{"client_token": token()}, {"client_token": token()}])
        require(sorted(status for status, _ in entered) == [200, 409], "Concurrent independent entries must have one winner")
        exit_token = token()
        exited = race(access, f"/api/gate/visitors/{visitor_id}/check-out/", [{"client_token": exit_token}, {"client_token": exit_token}])
        require([status for status, _ in exited] == [200, 200] and sorted(data["replayed"] for _, data in exited) == [False, True], "Concurrent same-token exit must replay one result")
        row.refresh_from_db()
        require(row.status == "EXITED" and row.entry_at <= row.exit_at, "Lifecycle timestamps/status invariant")
        events = GateAuditEvent.objects.filter(object_id=visitor_id)
        require(events.filter(action="VISITOR_ENTERED").count() == 1 and events.filter(action="VISITOR_EXITED").count() == 1, "Concurrent transitions duplicated audit events")
        api(watch.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 404, "Watchman cannot read closed-visit selfie")
        api(owner.get(f"/api/gate/visitors/{visitor_id}/selfie/"), 200, "Owner can inspect closed-visit selfie")
        api(watch.get("/api/gate/visitors/", {"status": "EXITED"}), 403, "Owner-only closed visitor history")
        closed = api(owner.get("/api/gate/visitors/", {"status": "EXITED", "search": nonce}), 200, "Owner full visitor history")
        require(visitor_id in {item["id"] for item in closed.json()["results"]}, "Owner history misses exited record")
        audit_response = api(owner.get("/api/gate/audit/", {"object_id": visitor_id}), 200, "Owner immutable audit")
        require(government_id not in body(audit_response) and mobile not in body(audit_response) and visitor_name not in body(audit_response), "Audit leaks sensitive visitor details")
        event = events.first()
        table = connection.ops.quote_name(GateAuditEvent._meta.db_table)
        for sql in [f"UPDATE {table} SET reason='QA attempted tamper' WHERE id=%s", f"DELETE FROM {table} WHERE id=%s"]:
            rejected = False
            try:
                with transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute(sql, [event.id])
            except DatabaseError:
                rejected = True
            require(rejected, "Database must reject audit history mutation")
        receipt_text = json.dumps(list(GateRequestReceipt.objects.filter(scope__contains=visitor_id).values("response")), sort_keys=True)
        require(government_id not in receipt_text and "selfie_data" not in receipt_text and "government_id_encrypted" not in receipt_text, "Lifecycle receipt leaks raw private fields")
        checks.append("concurrent lifecycle, chronological events, retained owner history, safe audit and database-level UPDATE/DELETE rejection")

        goods_data = {"client_token": token(), "plant": fixtures["plant"], "direction": "INWARD", "invoice_number": grn.vendor_invoice_no, "vehicle_number": grn.vehicle_no, "party_kind": "VENDOR", "party_id": fixtures["vendor"], "document_kind": "GRN", "document_id": str(grn.id)}
        goods = api(watch_cookie.post("/api/gate/goods/", goods_data, format="json"), 201, "Cookie-authenticated matched goods write").json()
        require(goods["reconciliation_status"] == "MATCHED" and goods["lines"][0]["uom"] == "PCS", "ERP match not derived from authoritative master/reference")
        repeat = api(watch.post("/api/gate/goods/", goods_data, format="json"), 201, "Goods retry").json()
        require(repeat["id"] == goods["id"] and repeat["replayed"], "Goods retry created duplicate")
        api(watch.post("/api/gate/goods/", {**goods_data, "invoice_number": f"changed-{nonce}"}, format="json"), 409, "Goods changed retry conflict")
        api(watch.post("/api/gate/goods/", {**goods_data, "client_token": token()}, format="json"), 409, "Duplicate goods/document conflict")
        api(watch.get(f"/api/gate/goods/{goods['id']}/"), 403, "Watchman owner detail ceiling")
        api(watch.post(f"/api/gate/goods/{goods['id']}/correct/", {"client_token": token(), "reason": "QA correction", "vehicle_number": "DD03U9999"}, format="json"), 403, "Watchman correction ceiling")
        api(owner.post(f"/api/gate/goods/{goods['id']}/correct/", {"client_token": token(), "reason": "QA observed vehicle mismatch", "vehicle_number": "DD03U9999"}, format="json"), 200, "Owner reasoned correction")
        corrected = api(owner.get(f"/api/gate/goods/{goods['id']}/"), 200, "Owner goods detail").json()
        require(corrected["reconciliation_status"] == "DISCREPANCY", "Physical correction must preserve discrepancy")
        mismatched = api(watch.post("/api/gate/goods/", {**goods_data, "client_token": token(), "document_id": str(mismatch_grn.id), "invoice_number": f"WRONG-{nonce}", "invoice_date": str(gate_today() - timedelta(days=1))}, format="json"), 201, "Selected-document invoice/date mismatch").json()
        require(mismatched["reconciliation_status"] == "DISCREPANCY", "Selecting a document cannot conceal differing invoice number/date")
        formula_invoice = f"=GATE-INV-{nonce}"
        unmatched = {"client_token": token(), "plant": fixtures["plant"], "direction": "INWARD", "invoice_number": formula_invoice, "vehicle_number": "DD03U9802", "party_kind": "VENDOR", "party_id": fixtures["vendor"], "lines": [{"product_kind": "MATERIAL", "product_id": fixtures["material"], "quantity": "1", "uom": "PCS"}]}
        logged = api(watch.post("/api/gate/goods/", unmatched, format="json"), 201, "Unmatched observed movement").json()
        require(logged["reconciliation_status"] == "UNMATCHED" and logged["amount"] is None, "Unmatched observations must not invent accounting amounts")
        report = api(delegate.get("/api/gate/reports/", {"plant": fixtures["plant"]}), 200, "Scoped delegated report")
        require(all(value not in body(report) for value in [government_id, mobile, visitor_name, "selfie_data", "government_id_encrypted"]), "Sanitized report leaks visitor personal data")
        other_report = api(delegate.get("/api/gate/reports/", {"plant": fixtures["other_plant"]}), 200, "Delegated sanitized cross-factory reports")
        require(all(value not in body(other_report) for value in [government_id, mobile, visitor_name, "selfie_data", "government_id_encrypted"]), "Cross-factory sanitized report leaks visitor personal data")
        csv_response = api(delegate.get("/api/gate/reports/csv/", {"plant": fixtures["plant"]}), 200, "Delegated CSV export")
        exported = list(csv.DictReader(io.StringIO(csv_response.content.decode("utf-8-sig"))))
        require(any(line["invoice_number"] == "'" + formula_invoice for line in exported), "CSV spreadsheet formula neutralization failed")
        require(all(value not in csv_response.content.decode() for value in [government_id, mobile, visitor_name]), "CSV leaks visitor personal data")
        yesterday = gate_today() - timedelta(days=1)
        GoodsMovement.objects.filter(id=logged["id"]).update(logged_at=timezone.now() - timedelta(days=1))
        api(watch.get("/api/gate/goods/", {"date_from": str(yesterday), "date_to": str(yesterday)}), 403, "Watchman historical-date restriction")
        history = api(owner.get("/api/gate/goods/", {"date_from": str(yesterday), "date_to": str(yesterday), "search": nonce}), 200, "Owner historical-date register")
        require(logged["id"] in {item["id"] for item in history.json()["results"]}, "Owner history misses earlier observation")
        checks.append("ERP-derived goods, invoice/date discrepancy, retry/duplicate guards, owner corrections/history, sanitized report entitlement and safe CSV")

        with CaptureQueriesContext(connection) as queries:
            api(owner.get("/api/gate/visitors/", {"search": nonce}), 200, "Private visitor list projection")
        payload_reads = [query["sql"] for query in queries.captured_queries if '"selfie_data"' in query["sql"] and 'CASE' not in query["sql"]]
        require(not payload_reads, "Visitor list loads full photo blobs")
        after = business_snapshot()
        require(after == before, "Gate operations changed protected inventory/sales/procurement/production rows")
        checks.append(f"full-row SQL fingerprints unchanged across {len(before)} ERP business tables; no list-photo N+1")
    result = {"status": "PASS", "checked_at": timezone.now().isoformat(), "environment": "isolated synthetic local PostgreSQL", "strict_rbac": False, "checks": checks, "business_table_count": len(before), "production_mutations": False}
    evidence = BASE / "docs/releases/watchman-20261007/independent-invariants.json"
    evidence.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
