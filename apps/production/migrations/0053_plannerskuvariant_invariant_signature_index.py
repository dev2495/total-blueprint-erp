from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0052_qualityreading"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS idx_psv_invariant_active "
                "ON production_planner_sku_variants (invariant_signature) "
                "WHERE active AND invariant_signature <> '';"
            ),
            reverse_sql="DROP INDEX IF EXISTS idx_psv_invariant_active;",
        ),
    ]
