"""
No-op compatibility migration.

The first draft of the PACKAGING/POD Product Master model tried to deactivate
unlinked inner-pouch catalog rows. That does not match the final flow: catalog
SKUs are fixed master rows and may stay purchased/manual until an admin links
one to a Product Master variant. This migration is intentionally empty so
future environments do not soft-delete valid unlinked packaging SKUs.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0029_pm_packaging_kind_and_variant_link"),
    ]

    operations = []
