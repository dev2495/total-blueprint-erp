"""Copy vendor / invoice details of bills reviewed before the document register
existed (kept in review_data) into the new header columns.

Never overwrites a typed value; re-running changes nothing. Only header columns
are written, which the arrival-evidence trigger allows.
"""
from datetime import date

from django.db import migrations


def _fiscal_year(value):
    return value.year if value.month >= 4 else value.year - 1


def backfill(apps, schema_editor):
    Intake = apps.get_model("gate", "InwardBillIntake")
    Vendor = apps.get_model("inventory", "Vendor")
    vendors = set(str(pk) for pk in Vendor.objects.values_list("id", flat=True))
    for bill in Intake.objects.exclude(review_data={}).iterator(chunk_size=500):
        review = bill.review_data or {}
        fields = []
        vendor_id = str(review.get("vendor_id") or "")
        if not bill.vendor_id and not bill.party_name and vendor_id in vendors:
            bill.vendor_id = vendor_id
            fields.append("vendor")
        invoice = " ".join(str(review.get("invoice_number") or "").split())[:80]
        if not bill.invoice_number and invoice:
            bill.invoice_number = invoice
            bill.invoice_normalized = invoice.upper()
            fields += ["invoice_number", "invoice_normalized"]
        if not bill.invoice_date and review.get("invoice_date"):
            try:
                bill.invoice_date = date.fromisoformat(str(review["invoice_date"]))
                fields.append("invoice_date")
            except ValueError:
                pass
        if bill.invoice_date and bill.invoice_fy is None:
            bill.invoice_fy = _fiscal_year(bill.invoice_date)
            fields.append("invoice_fy")
        if fields:
            bill.save(update_fields=fields)


class Migration(migrations.Migration):

    dependencies = [
        ("gate", "0004_documents_outward_gate_passes"),
        ("inventory", "0053_explicit_maintenance_audit"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
