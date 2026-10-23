"""Financial-year archive for long lists.

Once a financial year is closed (Stock lifecycle → Close, InventoryFinancialPeriod
CLOSED), its finished records leave the day-to-day lists: orders, challans, POs,
receipts, jobs, batches, stock ledgers. Nothing moves or is deleted: they stay in the
same tables, every detail link still opens them, and `?fy=2025-2026` (or `?fy=all`)
brings a year back. Records still open from a closed year (an order not yet
dispatched) always stay in the working set.

Indian financial years run 1 April to 31 March, counted on the factory clock.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Q
from rest_framework.exceptions import ValidationError

FACTORY_TZ = ZoneInfo("Asia/Kolkata")


@dataclass(frozen=True)
class ArchiveScope:
    date_field: str
    # Finished records; None means every row is final (ledgers, receipts).
    terminal: Q | None = None
    is_date: bool = False  # DateField rather than DateTimeField


def financial_year_dates(code: str) -> tuple[date, date]:
    try:
        start_year = int(str(code).split("-", 1)[0])
        if not 2000 <= start_year <= 2100:
            raise ValueError
    except (TypeError, ValueError):
        raise ValidationError({"fy": "Financial year must look like 2025-2026."})
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


def financial_year_of(day: date) -> str:
    start_year = day.year if day.month >= 4 else day.year - 1
    return f"{start_year}-{start_year + 1}"


def closed_years() -> list[str]:
    from config.request_context import request_memo

    def load():
        from apps.inventory.models import InventoryFinancialPeriod

        return list(InventoryFinancialPeriod.objects.filter(status="CLOSED").values_list("financial_year", flat=True))

    return request_memo(("archive_closed_years",), load)


def _range_q(scope: ArchiveScope, start: date, end: date) -> Q:
    if scope.is_date:
        return Q(**{f"{scope.date_field}__gte": start, f"{scope.date_field}__lte": end})
    lo = datetime.combine(start, time.min, tzinfo=FACTORY_TZ)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=FACTORY_TZ)
    return Q(**{f"{scope.date_field}__gte": lo, f"{scope.date_field}__lt": hi})


def apply_archive_scope(queryset, request, scope: ArchiveScope):
    fy = str(request.query_params.get("fy") or "").strip().lower()
    if fy == "all":
        return queryset
    if fy and fy not in {"current", "working"}:
        start, end = financial_year_dates(fy)
        return queryset.filter(_range_q(scope, start, end))
    archived = Q()
    for code in closed_years():
        start, end = financial_year_dates(code)
        archived |= _range_q(scope, start, end)
    if not archived:
        return queryset
    if scope.terminal is not None:
        archived &= scope.terminal
    return queryset.exclude(archived)


class ArchiveScopedListMixin:
    """List endpoints show the working set by default; ?fy= picks a year. Detail views are never scoped."""

    archive_scope: ArchiveScope | None = None

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if self.archive_scope is not None and self.request.method == "GET" and getattr(self, "action", "list") == "list":
            queryset = apply_archive_scope(queryset, self.request, self.archive_scope)
        return queryset


class NewestRowsListMixin:
    """Ledger lists answer with the newest rows only (default 1,000, ?limit= up to 5,000).

    The response stays a plain list; when rows were left out it carries X-Result-Limited,
    X-Result-Limit and X-Total-Count so the screen can say so and point to filters or the
    year picker. A ledger list is evidence to browse, never something to download whole.
    """

    list_default_limit = 1000
    list_max_limit = 5000

    def list(self, request, *args, **kwargs):
        from rest_framework.response import Response

        queryset = self.filter_queryset(self.get_queryset())
        try:
            limit = int(request.query_params.get("limit") or self.list_default_limit)
        except (TypeError, ValueError):
            limit = self.list_default_limit
        limit = max(1, min(limit, self.list_max_limit))
        rows = list(queryset[: limit + 1])
        limited = len(rows) > limit
        response = Response(self.get_serializer(rows[:limit], many=True).data)
        if limited:
            response["X-Result-Limited"] = "1"
            response["X-Result-Limit"] = str(limit)
            response["X-Total-Count"] = str(queryset.count())
        return response
