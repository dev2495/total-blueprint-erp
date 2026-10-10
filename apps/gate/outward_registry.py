"""Registries for ERP documents that can be matched to an outward gate photo.

Two hooks exist per document kind (see docs/documents-jobwork/SPEC.md §3.2):

* ``apps.gate.qr.register_qr_kind(kind, resolve, on_gate_out=None)`` — resolves
  one record by id (QR scan, manual link, link-by-code). ``resolve(object_id,
  plant)`` returns an OutwardLinkSnapshot dict or raises ValidationError.
* ``register_outward_search(kind, search)`` (this module) — office candidate
  search on the matching screen. ``search(plant, query, *, around, limit)``
  returns a list of OutwardLinkSnapshot dicts for records at ``plant``:

  - ``query``: trimmed text (≤100 chars, may be empty). Empty means "recent
    records near the departure", i.e. dated within a few days of ``around``.
  - ``around``: the departure datetime (aware).
  - ``limit``: maximum rows to return (≤25).
  - Must never move stock or change the records; read-only queries only.
  - Exclude records that can never leave the gate (cancelled, other plant).

OutwardLinkSnapshot::

    {"kind", "id", "reference", "party_name", "plant", "plant_name", "status",
     "document_date", "lines": [{"description", "quantity", "uom"}],
     "summary", "warnings": [str, ...]}

No prices or amounts are ever placed in a snapshot (the watchman sees it).
"""
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone

OUTWARD_SEARCHES = {}
MAX_SNAPSHOT_LINES = 50
NEAR_DEPARTURE = timedelta(days=4)


def register_outward_search(kind, search):
    from .qr import QR_KINDS

    if kind not in QR_KINDS:
        raise ValueError(f"Unknown outward document kind {kind}")
    OUTWARD_SEARCHES[kind] = search


def outward_search_kinds():
    return sorted(OUTWARD_SEARCHES)


def iso(value):
    if value is None:
        return None
    if hasattr(value, "tzinfo") and value.tzinfo is not None:
        return timezone.localtime(value).isoformat()
    return value.isoformat()


def quantity_text(value):
    if value is None:
        return None
    text = format(value.normalize() if hasattr(value, "normalize") else value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def summarise(lines, *, unit_word="line", count=None):
    """Short count text such as "3 lines · 412.5 KG" (never amounts)."""
    count = len(lines) if count is None else count
    totals = {}
    for line in lines:
        uom = str(line.get("uom") or "").upper()
        try:
            totals[uom] = totals.get(uom, Decimal("0")) + Decimal(str(line.get("quantity") or "0"))
        except InvalidOperation:
            continue
    words = f"{count} {unit_word}{'' if count == 1 else 's'}"
    if totals and len(totals) <= 2:
        words += " · " + " + ".join(f"{quantity_text(qty)} {uom}".strip() for uom, qty in totals.items() if qty)
    return words.rstrip(" ·")


def build_snapshot(*, kind, obj_id, reference, party_name, plant, status, document_date, lines, summary=None, warnings=None, unit_word="line"):
    rows = [
        {"description": str(row.get("description") or "")[:255], "quantity": quantity_text(row.get("quantity")), "uom": str(row.get("uom") or "")}
        for row in lines
    ]
    return {
        "kind": kind,
        "id": str(obj_id),
        "reference": str(reference or "")[:120],
        "party_name": str(party_name or "")[:255],
        "plant": str(plant.id) if plant else None,
        "plant_name": plant.name if plant else "",
        "status": status,
        "document_date": iso(document_date),
        "lines": rows[:MAX_SNAPSHOT_LINES],
        "line_count": len(rows),
        "summary": summary or summarise(rows, unit_word=unit_word),
        "warnings": list(warnings or []),
    }
