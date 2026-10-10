"""Financial-year document numbers shared by office documents.

Numbers look like ``GR-2627-000123``: prefix, Indian April–March financial
year (``2627`` = FY 2026-27) and a zero-padded counter. The counter row is
locked inside the caller's transaction, so concurrent issuers never receive
the same number. A rolled-back transaction leaves no gap because the counter
update rolls back with it.
"""
from django.db import transaction
from django.utils import timezone

from .models import DocumentSequence
from .services import gate_zone, invoice_fiscal_year


def fiscal_year_for(value=None):
    moment = value or timezone.now()
    if hasattr(moment, "astimezone"):
        moment = moment.astimezone(gate_zone()).date()
    return invoice_fiscal_year(moment)


def fiscal_label(fiscal_year):
    return f"{fiscal_year % 100:02d}{(fiscal_year + 1) % 100:02d}"


def next_document_number(key, *, prefix=None, width=6, at=None):
    """Return the next number for ``key``. Must run inside ``transaction.atomic``."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("Document numbers must be issued inside a transaction.")
    fiscal_year = fiscal_year_for(at)
    sequence, _ = DocumentSequence.objects.select_for_update().get_or_create(key=key, fiscal_year=fiscal_year)
    sequence.last_value += 1
    sequence.save(update_fields=["last_value"])
    return f"{prefix or key}-{fiscal_label(fiscal_year)}-{sequence.last_value:0{width}d}"
