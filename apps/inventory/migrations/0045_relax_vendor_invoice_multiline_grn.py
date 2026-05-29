from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0044_bulktransaction_manual_po_ref_and_more"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="DROP INDEX IF EXISTS uniq_bulk_tx_vendor_invoice;",
                    reverse_sql=(
                        "CREATE UNIQUE INDEX uniq_bulk_tx_vendor_invoice "
                        "ON inventory_bulk_transactions (vendor_id, vendor_invoice_no) "
                        "WHERE vendor_invoice_no > '' AND vendor_id IS NOT NULL;"
                    ),
                ),
            ],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="bulktransaction",
                    name="uniq_bulk_tx_vendor_invoice",
                ),
            ],
        ),
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="DROP INDEX IF EXISTS uniq_pkg_tx_vendor_invoice;",
                    reverse_sql=(
                        "CREATE UNIQUE INDEX uniq_pkg_tx_vendor_invoice "
                        "ON inventory_packaging_transactions (vendor_id, vendor_invoice_no) "
                        "WHERE vendor_invoice_no > '' AND vendor_id IS NOT NULL;"
                    ),
                ),
            ],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="packagingtransaction",
                    name="uniq_pkg_tx_vendor_invoice",
                ),
            ],
        ),
    ]
