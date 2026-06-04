from django.db import migrations, models
import django.db.models.deletion


def _normalize_code(value, max_length=80):
    raw = str(value or "").upper().strip()
    out = []
    last_dash = False
    for char in raw:
        if char.isalnum():
            out.append(char)
            last_dash = False
        else:
            if not last_dash:
                out.append("-")
                last_dash = True
    return "".join(out).strip("-")[:max_length] or "PM"


def _version_parts(code):
    normalized = _normalize_code(code)
    if "-V" in normalized:
        prefix, suffix = normalized.rsplit("-V", 1)
        if prefix and suffix.isdigit():
            return prefix, max(1, int(suffix))
    return normalized, 1


def backfill_product_master_versions(apps, schema_editor):
    ProductMaster = apps.get_model("materials", "ProductMaster")
    rows = list(ProductMaster.objects.all().only("id", "code", "active", "created_at"))
    grouped = {}
    for row in rows:
        root, version = _version_parts(row.code)
        row.version_group = root
        row.version = version
        grouped.setdefault(root, []).append(row)

    for group_rows in grouped.values():
        latest = sorted(
            group_rows,
            key=lambda item: (
                int(getattr(item, "version", 1) or 1),
                1 if getattr(item, "active", False) else 0,
                str(getattr(item, "created_at", "") or ""),
                str(getattr(item, "id", "")),
            ),
        )[-1]
        has_multiple_versions = len(group_rows) > 1
        for row in group_rows:
            is_latest = row.id == latest.id
            row.is_current_version = is_latest
            row.superseded_by_id = None if is_latest else latest.id
            if has_multiple_versions and not is_latest:
                row.active = False
            row.save(
                update_fields=[
                    "version_group",
                    "version",
                    "is_current_version",
                    "superseded_by",
                    "active",
                ]
            )


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0046_remove_pouchstylemaster_faces"),
    ]

    operations = [
        migrations.AddField(
            model_name="productmaster",
            name="is_current_version",
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AddField(
            model_name="productmaster",
            name="superseded_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="superseded_versions",
                to="materials.productmaster",
            ),
        ),
        migrations.AddField(
            model_name="productmaster",
            name="version",
            field=models.PositiveIntegerField(db_index=True, default=1),
        ),
        migrations.AddField(
            model_name="productmaster",
            name="version_group",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                help_text="Stable root code shared by all versions of this Product Master.",
                max_length=80,
            ),
        ),
        migrations.RunPython(backfill_product_master_versions, migrations.RunPython.noop),
    ]
