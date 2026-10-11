"""Classify historical bulk location transfers as TRANSFER.

BulkService.transfer_bulk used to post the outgoing leg as CONSUME and the
incoming leg as INWARD, so internal moves (job-work returns, inter-plant
receipts, WIP top-ups) appeared in GRN history and bill receipt matching as
goods receipts and in consumption as usage. Both legs are now TRANSFER.

Only rows that are unmistakably transfer legs are retyped: the reference
written by transfer_bulk, no vendor, no vendor invoice, and not already linked
to a supplier bill or a GRN correction (those stay untouched so existing
links keep resolving).
"""
from django.db import migrations


def retype_transfer_legs(apps, schema_editor):
    BulkTransaction = apps.get_model("inventory", "BulkTransaction")
    InwardBillReceiptReference = apps.get_model("gate", "InwardBillReceiptReference")
    InventoryCorrectionAudit = apps.get_model("inventory", "InventoryCorrectionAudit")

    linked = set(
        InwardBillReceiptReference.objects.filter(kind="BULK").values_list("object_id", flat=True)
    ) | set(
        InventoryCorrectionAudit.objects.filter(source_type="BULK").values_list("source_id", flat=True)
    )
    for prefix, old_type in (("Transfer In: ", "INWARD"), ("Transfer Out: ", "CONSUME")):
        candidates = BulkTransaction.objects.filter(
            type=old_type,
            reference__startswith=prefix,
            vendor__isnull=True,
            vendor_invoice_no="",
        ).exclude(id__in=linked)
        candidates.update(type="TRANSFER")


class Migration(migrations.Migration):

    dependencies = [
        ("gate", "0005_backfill_document_headers"),
        ("inventory", "0056_job_work_step_release_and_bill_links"),
    ]

    operations = [migrations.RunPython(retype_transfer_legs, migrations.RunPython.noop)]
