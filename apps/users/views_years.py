"""Financial years for the header year picker (every signed-in role)."""
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from config.archive import financial_year_dates, financial_year_of


class FinancialYearsView(APIView):
    def get(self, request):
        from apps.inventory.models import InventoryFinancialPeriod

        current = financial_year_of(timezone.localtime(timezone.now(), timezone.get_fixed_timezone(330)).date())
        periods = {code: (status, start, end) for code, status, start, end in InventoryFinancialPeriod.objects.values_list("financial_year", "status", "start_date", "end_date")}
        if current not in periods:
            periods[current] = ("OPEN", *financial_year_dates(current))
        years = []
        for code in sorted(periods, key=lambda c: periods[c][1] or financial_year_dates(current)[0], reverse=True):
            status, start, end = periods[code]
            if not start or not end:
                continue
            years.append({
                "code": code,
                "label": f"FY {start.year}-{str(end.year)[-2:]}",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "status": status,
                "archived": status == "CLOSED",
                "current": code == current,
            })
        return Response({"current": current, "years": years})
