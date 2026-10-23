"""Financial years for the header year picker (every signed-in role)."""
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from config.archive import financial_year_dates, financial_year_of


class FinancialYearsView(APIView):
    def get(self, request):
        from apps.inventory.models import InventoryFinancialPeriod

        current = financial_year_of(timezone.localtime(timezone.now(), timezone.get_fixed_timezone(330)).date())
        status_by_year = dict(InventoryFinancialPeriod.objects.values_list("financial_year", "status"))
        codes = set(status_by_year) | {current}
        years = []
        for code in sorted(codes, reverse=True):
            start, end = financial_year_dates(code)
            status = status_by_year.get(code, "OPEN")
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
