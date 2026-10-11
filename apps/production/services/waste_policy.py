"""Wastage reasons on machine output logs.

When an operator logs trim and scrap with an output, the wastage share of
that run (waste / (output + waste)) is compared with the company limit
(CompanyProfile.waste_reason_threshold_pct, 5 % by default). At or above the
limit the operator must pick a scrap reason and say why; below it the reason
and note stay optional. The reason is stored on the ScrapLog rows, so scrap
reports group real causes instead of a fixed "defect".
"""
from decimal import Decimal, InvalidOperation

DEFAULT_WASTE_REASON_THRESHOLD_PCT = Decimal("5.00")
MIN_WASTE_NOTE_LENGTH = 5
MAX_WASTE_NOTE_LENGTH = 500
SCRAP_LOG_REASON_MAX_LENGTH = 20


def waste_reason_threshold_pct() -> Decimal:
    from apps.users.models import CompanyProfile

    value = CompanyProfile.objects.filter(pk=1).values_list("waste_reason_threshold_pct", flat=True).first()
    if value is None:
        return DEFAULT_WASTE_REASON_THRESHOLD_PCT
    return Decimal(str(value))


def waste_pct(output_kg, waste_kg) -> Decimal:
    output_kg = Decimal(str(output_kg or 0))
    waste_kg = Decimal(str(waste_kg or 0))
    total = output_kg + waste_kg
    if waste_kg <= 0 or total <= 0:
        return Decimal("0")
    return (waste_kg * Decimal("100") / total).quantize(Decimal("0.01"))


def _resolve_reason(reason: str) -> str:
    """The code to store on ScrapLog.reason (at most 20 characters)."""
    from apps.production.models import ScrapLog, ScrapReason

    if reason in {code for code, _ in ScrapLog.REASON_CHOICES}:
        return reason
    row = ScrapReason.objects.select_related("parent").filter(code__iexact=reason, is_active=True).first()
    if row is None:
        raise ValueError("Choose a wastage reason from the scrap reason list.")
    for candidate in (row.code, getattr(row.parent, "code", "")):
        candidate = str(candidate or "").upper()
        if candidate and len(candidate) <= SCRAP_LOG_REASON_MAX_LENGTH:
            return candidate
    raise ValueError("This scrap reason code is too long to record; ask an administrator to shorten it.")


def validate_output_waste(output_kg, waste_kg, reason, note, *, require_reason_above_limit=True):
    """Return the (reason_code, note) to store, or raise ValueError.

    ``require_reason_above_limit`` is set for operator entries from the
    machine terminal; system and acceptance flows that post output keep their
    own reasons and are not blocked.
    """
    reason = str(reason or "").strip().upper()
    note = str(note or "").strip()
    if len(note) > MAX_WASTE_NOTE_LENGTH:
        raise ValueError(f"Keep the wastage note under {MAX_WASTE_NOTE_LENGTH} characters.")
    if reason:
        reason = _resolve_reason(reason)
    try:
        waste = Decimal(str(waste_kg or 0))
    except (InvalidOperation, TypeError, ValueError):
        waste = Decimal("0")
    if waste <= 0 or not require_reason_above_limit:
        return reason, note
    share = waste_pct(output_kg, waste)
    limit = waste_reason_threshold_pct()
    if share >= limit and (not reason or len(note) < MIN_WASTE_NOTE_LENGTH):
        raise ValueError(
            f"Wastage is {share}% of this run (limit {limit}%). "
            "Choose a wastage reason and write why it happened before logging the output."
        )
    return reason, note
