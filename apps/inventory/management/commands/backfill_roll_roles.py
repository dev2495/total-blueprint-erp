from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.inventory.models import InventoryRoll


class Command(BaseCommand):
    help = "Backfill roll role and remainder source-stage metadata with high-confidence heuristics."

    def add_arguments(self, parser):
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Persist updates. Without this flag command runs in dry-run mode.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional max number of rolls to inspect.",
        )

    def _infer_role(self, roll):
        meta = dict(roll.meta_json or {})
        explicit = str(meta.get("roll_role") or "").upper()
        if explicit:
            return explicit, True

        if bool(meta.get("is_remainder")):
            return "REMAINDER", True

        parent = getattr(roll, "parent_roll", None)
        if parent:
            if any(meta.get(k) for k in ("source_stage_index", "source_stage_name", "source_process_code", "source_roll_label", "remainder_of", "balance_of")):
                return "REMAINDER", True
            label = str(roll.label_id or "").upper()
            if any(marker in label for marker in ("REMAINDER", "REM", "BAL", "BALANCE")):
                return "REMAINDER", True
            try:
                parent_weight = Decimal(str(parent.weight_kg or 0))
                child_weight = Decimal(str(roll.weight_kg or 0))
            except Exception:
                parent_weight = Decimal("0")
                child_weight = Decimal("0")
            same_job = bool(parent.production_job_id and roll.production_job_id and str(parent.production_job_id) == str(roll.production_job_id))
            parent_open = str(parent.status or "").upper() in {"AVAILABLE", "RESERVED", "IN_PROCESS"}
            parent_consumed = str(parent.status or "").upper() == "CONSUMED"
            if same_job and parent_open and child_weight > parent_weight and not bool(roll.is_fg):
                return "REMAINDER", True
            if same_job and parent_consumed and not bool(roll.is_fg):
                same_stage = getattr(roll, "stage_index", None) == getattr(parent, "stage_index", None)
                same_step = getattr(roll, "current_step_index", None) == getattr(parent, "current_step_index", None)
                same_created_process = (
                    getattr(roll, "created_process_id", None)
                    and getattr(parent, "created_process_id", None)
                    and str(getattr(roll, "created_process_id", "")) == str(getattr(parent, "created_process_id", ""))
                )
                if (same_stage and same_step) or (same_stage and same_created_process):
                    return "REMAINDER", True
            if parent_consumed and getattr(roll, "stage_index", None) == getattr(parent, "stage_index", None):
                return "REMAINDER", True

        if roll.is_fg:
            return "FG", True
        if roll.created_by_job_id or roll.production_job_id:
            return "OUTPUT", True

        return None, False

    def _source_stage_name(self, roll):
        try:
            from apps.inventory.serializers import resolve_roll_stage_name

            return resolve_roll_stage_name(roll)
        except Exception:
            return None

    def handle(self, *args, **options):
        commit = bool(options.get("commit"))
        limit = int(options.get("limit") or 0)

        qs = InventoryRoll.objects.select_related("parent_roll", "created_process").order_by("created_at")
        if limit > 0:
            qs = qs[:limit]

        updated = 0
        skipped = 0
        ambiguous = 0
        report_rows = []

        ctx = transaction.atomic() if commit else transaction.atomic()
        with ctx:
            for roll in qs:
                meta = dict(roll.meta_json or {})
                role, confident = self._infer_role(roll)
                if not role:
                    ambiguous += 1
                    report_rows.append((str(roll.id), roll.label_id, "AMBIGUOUS", "Unable to infer role"))
                    continue

                if not confident:
                    ambiguous += 1
                    report_rows.append((str(roll.id), roll.label_id, "AMBIGUOUS", f"Low confidence role={role}"))
                    continue

                changed = False
                if str(meta.get("roll_role") or "").upper() != role:
                    meta["roll_role"] = role
                    changed = True
                if role == "REMAINDER":
                    meta["is_remainder"] = True
                    parent = roll.parent_roll
                    if parent:
                        if not meta.get("source_stage_index"):
                            meta["source_stage_index"] = parent.stage_index
                            changed = True
                        if not meta.get("source_stage_name"):
                            stage_name = self._source_stage_name(parent)
                            if stage_name:
                                meta["source_stage_name"] = stage_name
                                changed = True
                        if not meta.get("source_process_code") and parent.created_process:
                            meta["source_process_code"] = parent.created_process.code
                            changed = True
                        if not meta.get("source_roll_label"):
                            meta["source_roll_label"] = parent.label_id
                            changed = True

                if changed:
                    updated += 1
                    report_rows.append((str(roll.id), roll.label_id, "UPDATED", role))
                    if commit:
                        roll.meta_json = meta
                        roll.save(update_fields=["meta_json"])
                else:
                    skipped += 1

            if not commit:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            f"Backfill complete (commit={commit}) | updated={updated} skipped={skipped} ambiguous={ambiguous}"
        ))
        for roll_id, label, status, note in report_rows[:200]:
            self.stdout.write(f"{status:9} {label:28} {roll_id} {note}")
        if len(report_rows) > 200:
            self.stdout.write(f"... truncated {len(report_rows) - 200} rows")
