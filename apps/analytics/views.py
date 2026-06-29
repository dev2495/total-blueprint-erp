from io import BytesIO
import json
from pathlib import Path

from django.http import FileResponse
from django.conf import settings
from django.core.cache import cache
from rest_framework import viewsets
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from apps.analytics.services import AnalyticsService, KPIService, FactoryOverviewService, ReportingService
from apps.analytics.report_delivery import ReportDistributionService
from apps.analytics.pdf_exports import AnalyticsPDFExportService
from apps.analytics.reports_service import ReportService
from django.utils import timezone
from django.utils.dateparse import parse_date
import logging

logger = logging.getLogger(__name__)


def _effective_role_code(user) -> str:
    return str(getattr(user, "effective_role_code", getattr(getattr(user, "role", None), "code", "")) or "").upper()


def _is_reports_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    return bool(user.is_superuser or user.is_owner or _effective_role_code(user) in {"ADMIN", "SUPER_ADMIN", "OWNER"})


def _reports_admin_forbidden_response(user, action: str):
    logger.warning(
        "Denied analytics reports admin action for user=%s action=%s",
        getattr(user, "username", "anonymous"),
        action,
    )
    return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)


def _bounded_int(value, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


def _error_response(
    code: str = "ANALYTICS_ERROR",
    http_status: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
    message: str = "Analytics request failed.",
):
    return Response(
        {
            "status": "error",
            "message": "Request failed.",
            "detail": message,
            "code": code,
            "results": [],
            "data": {},
            "count": 0,
        },
        status=http_status,
    )


def _empty_trading_block():
    return {
        "trading_stock_value_inr": 0.0,
        "open_trade_orders": 0,
        "trade_revenue_mtd_inr": 0.0,
        "trade_margin_pct": 0.0,
        "trade_revenue_delta_pct": 0.0,
        "top_trading_good": None,
        "trade_revenue_series": [],
    }


def _build_control_tower_trading_block(timeframe: str = "month"):
    """Compact trading subset for the owner control tower payload.

    Uses the trading metrics service for the current month so the dashboard
    avoids a second round-trip.
    """
    from datetime import timedelta as _td
    today = timezone.now().date()
    if timeframe == "day":
        start = today
    elif timeframe == "week":
        start = today - _td(days=7)
    elif timeframe == "year":
        start = today - _td(days=365)
    else:
        start = today.replace(day=1)

    filters = {"start_date": start, "end_date": today}
    data = ReportService.get_trading_metrics(filters)
    summary = data.get("summary") or {}
    breakdowns = data.get("breakdowns") or {}
    top_items = breakdowns.get("top_items") or []
    top_trading_good = None
    for item in top_items:
        if item.get("kind") == "TRADING_GOOD":
            top_trading_good = {
                "name": item.get("name") or "—",
                "code": item.get("code") or "",
                "revenue_inr": float(item.get("revenue_inr") or 0),
            }
            break

    # Last 14 days revenue series — pad missing days with 0.
    series = data.get("series") or []
    last_14_start = today - _td(days=13)
    series_map = {row.get("date"): float(row.get("revenue_inr") or 0) for row in series if row.get("date")}
    last_14 = []
    for i in range(14):
        d = last_14_start + _td(days=i)
        key = d.isoformat()
        last_14.append({"date": key, "revenue_inr": series_map.get(key, 0.0)})

    return {
        "trading_stock_value_inr": float(summary.get("total_tradeable_value_inr") or 0),
        "open_trade_orders": int(summary.get("open_trade_orders") or 0),
        "trade_revenue_mtd_inr": float(summary.get("trade_revenue_inr") or 0),
        "trade_margin_pct": float(summary.get("trade_gross_margin_pct") or 0),
        "trade_revenue_delta_pct": float(summary.get("trade_revenue_delta_pct") or 0),
        "top_trading_good": top_trading_good,
        "trade_revenue_series": last_14,
    }


def _empty_procurement_block():
    return {
        "open_pos_count": 0,
        "open_po_value_inr": 0.0,
        "overdue_pos_count": 0,
        "mtd_spend_inr": 0.0,
        "avg_cycle_days": 0.0,
        "top_vendors": [],
    }


def _build_control_tower_procurement_block():
    """Compact procurement subset for the owner control tower payload.

    Mirrors the trading block — single helper that the dashboard consumes
    so the owner page can render a Procurement Pulse section without a
    second round-trip. Guarded with try/except so a missing migration or
    empty database never blows up the dashboard.
    """
    from datetime import timedelta as _td
    from decimal import Decimal as _Dec

    from django.db.models import Avg, Count, F, Sum
    from django.db.models.functions import Coalesce

    try:
        from apps.procurement.models import PurchaseOrder
    except Exception:
        return _empty_procurement_block()

    today = timezone.now().date()
    month_start = today.replace(day=1)

    try:
        terminal = ["COMPLETED", "CANCELLED"]
        open_qs = PurchaseOrder.objects.exclude(status__in=terminal)
        open_pos_count = open_qs.count()
        open_po_value = open_qs.aggregate(total=Coalesce(Sum("grand_total"), _Dec("0")))["total"] or _Dec("0")

        overdue_pos_count = open_qs.filter(
            expected_delivery_date__isnull=False,
            expected_delivery_date__lt=today,
        ).count()

        mtd_qs = PurchaseOrder.objects.filter(
            status="COMPLETED",
            order_date__gte=month_start,
            order_date__lte=today,
        )
        mtd_spend = mtd_qs.aggregate(total=Coalesce(Sum("grand_total"), _Dec("0")))["total"] or _Dec("0")

        # Average cycle for POs completed in the last 30 days.
        cycle_qs = PurchaseOrder.objects.filter(
            status="COMPLETED",
            completed_at__isnull=False,
            completed_at__gte=timezone.now() - _td(days=30),
        )
        avg_cycle_days = 0.0
        cycle_samples = []
        for po in cycle_qs.only("order_date", "completed_at")[:200]:
            try:
                completed_date = po.completed_at.date() if hasattr(po.completed_at, "date") else po.completed_at
                delta = (completed_date - po.order_date).days
                if delta >= 0:
                    cycle_samples.append(delta)
            except Exception:
                continue
        if cycle_samples:
            avg_cycle_days = round(sum(cycle_samples) / len(cycle_samples), 1)

        # Top vendors this month by COMPLETED + open spend (use grand_total).
        top_qs = (
            PurchaseOrder.objects.filter(order_date__gte=month_start, order_date__lte=today)
            .values("vendor_id", vendor_name=F("vendor__name"))
            .annotate(total=Coalesce(Sum("grand_total"), _Dec("0")), count=Count("id"))
            .order_by("-total")[:5]
        )
        top_vendors = [
            {
                "vendor_id": str(row.get("vendor_id")) if row.get("vendor_id") is not None else None,
                "vendor_name": row.get("vendor_name") or "—",
                "total_inr": float(row.get("total") or 0),
                "po_count": int(row.get("count") or 0),
            }
            for row in top_qs
        ]

        return {
            "open_pos_count": int(open_pos_count),
            "open_po_value_inr": float(open_po_value),
            "overdue_pos_count": int(overdue_pos_count),
            "mtd_spend_inr": float(mtd_spend),
            "avg_cycle_days": float(avg_cycle_days),
            "top_vendors": top_vendors,
        }
    except Exception as exc:
        logger.warning("Procurement block build failed: %s", str(exc))
        return _empty_procurement_block()


def _load_capability_registry():
    registry_path = Path(getattr(settings, "BASE_DIR", ".")) / "docs" / "runbooks" / "capability-registry.json"
    with registry_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)

class AnalyticsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get', 'put'], url_path='report-distributions')
    def report_distributions(self, request):
        if request.method.lower() == "get":
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "report_distributions.read")
            profiles = [ReportDistributionService.serialize_profile(row) for row in ReportDistributionService.list_profiles()]
            return Response({"profiles": profiles})
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_distributions.update")
        raw_profiles = request.data if isinstance(request.data, list) else request.data.get("profiles", [])
        updated = ReportDistributionService.update_profiles(raw_profiles, updated_by=request.user)
        return Response({"profiles": [ReportDistributionService.serialize_profile(row) for row in updated]})

    @action(detail=False, methods=['post'], url_path=r'report-distributions/(?P<report_code>[^/.]+)/send')
    def send_report_distribution(self, request, report_code=None):
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_distributions.send")
        profile = next((row for row in ReportDistributionService.list_profiles() if row.report_code == report_code), None)
        if not profile:
            return Response({"error": "Unknown report distribution."}, status=status.HTTP_404_NOT_FOUND)
        explicit_date = parse_date(str(request.data.get("report_date") or "").strip()) if request.data.get("report_date") else None
        try:
            run = ReportDistributionService.send_profile(
                profile,
                report_date=explicit_date,
                triggered_by=request.user,
                triggered_manually=True,
            )
        except Exception as exc:
            logger.error("Manual report dispatch failed (%s): %s", report_code, str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_SEND_FAILED")
        return Response({"run": ReportDistributionService.serialize_run(run)})

    @action(detail=False, methods=['get'], url_path='report-runs')
    def report_runs(self, request):
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_runs.read")
        limit = _bounded_int(request.query_params.get("limit", 30), default=30, minimum=1, maximum=100)
        days = request.query_params.get("days")
        runs = [ReportDistributionService.serialize_run(row) for row in ReportDistributionService.list_runs(limit=limit, days=int(days) if str(days or "").isdigit() else None)]
        return Response({"runs": runs})

    @action(detail=False, methods=['get'], url_path=r'report-runs/(?P<run_id>[^/.]+)/preview-pdf')
    def report_run_preview_pdf(self, request, run_id=None):
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_runs.preview")
        run = ReportDistributionService.get_run(run_id)
        if not run:
            return Response({"error": "Report run not found."}, status=status.HTTP_404_NOT_FOUND)
        stored_pdf = ReportDistributionService.stored_pdf_path(run)
        if stored_pdf:
            return FileResponse(
                stored_pdf.open("rb"),
                filename=run.pdf_file_name or stored_pdf.name,
                content_type="application/pdf",
            )
        try:
            rendered = ReportDistributionService.render_report(run.report_code, report_date=run.report_date)
        except Exception as exc:
            logger.error("Report preview failed (%s): %s", run_id, str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_PREVIEW_FAILED")
        return FileResponse(
            BytesIO(rendered.pdf),
            filename=rendered.file_name,
            content_type="application/pdf",
        )

    @action(detail=False, methods=['get'], url_path=r'report-runs/(?P<run_id>[^/.]+)/download-pdf')
    def report_run_download_pdf(self, request, run_id=None):
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_runs.download_pdf")
        run = ReportDistributionService.get_run(run_id)
        if not run:
            return Response({"error": "Report run not found."}, status=status.HTTP_404_NOT_FOUND)
        stored_pdf = ReportDistributionService.stored_pdf_path(run)
        if stored_pdf:
            return FileResponse(
                stored_pdf.open("rb"),
                filename=run.pdf_file_name or stored_pdf.name,
                content_type="application/pdf",
                as_attachment=True,
            )
        try:
            rendered = ReportDistributionService.render_report(run.report_code, report_date=run.report_date)
        except Exception as exc:
            logger.error("Report download failed (%s): %s", run_id, str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_PREVIEW_FAILED")
        return FileResponse(
            BytesIO(rendered.pdf),
            filename=rendered.file_name,
            content_type="application/pdf",
            as_attachment=True,
        )

    @action(detail=False, methods=['get'], url_path=r'report-runs/(?P<run_id>[^/.]+)/download-detail')
    def report_run_download_detail(self, request, run_id=None):
        if not _is_reports_admin(request.user):
            return _reports_admin_forbidden_response(request.user, "report_runs.download_detail")
        run = ReportDistributionService.get_run(run_id)
        if not run:
            return Response({"error": "Report run not found."}, status=status.HTTP_404_NOT_FOUND)
        stored_detail = ReportDistributionService.stored_detail_path(run)
        if stored_detail:
            return FileResponse(
                stored_detail.open("rb"),
                filename=run.detail_file_name or stored_detail.name,
                content_type="application/octet-stream",
                as_attachment=True,
            )
        try:
            rendered = ReportDistributionService.render_report(run.report_code, report_date=run.report_date)
        except Exception as exc:
            logger.error("Report detail download failed (%s): %s", run_id, str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_DETAIL_FAILED")
        if not rendered.detail_attachments:
            return Response({"error": "No detail attachment available for this report run."}, status=status.HTTP_404_NOT_FOUND)
        attachment = rendered.detail_attachments[0]
        return FileResponse(
            BytesIO(attachment.content),
            filename=attachment.file_name,
            content_type=attachment.content_type,
        )

    @action(detail=False, methods=['get'], url_path='capability-matrix')
    def capability_matrix(self, request):
        try:
            return Response(_load_capability_registry())
        except FileNotFoundError:
            return _error_response(code="ANALYTICS_CAPABILITY_MATRIX_MISSING", http_status=status.HTTP_404_NOT_FOUND, message="Capability registry file not found.")
        except Exception as exc:
            logger.error("Capability matrix load failed: %s", str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_CAPABILITY_MATRIX_FAILED")

    @action(detail=False, methods=['get'], url_path='system-debug')
    def system_debug(self, request):
        try:
            return Response(
                {
                    "status": "ok",
                    "generated_at": timezone.now().isoformat(),
                    "service": "analytics",
                    "version": "v2",
                }
            )
        except Exception as e:
            logger.error(f"System debug error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_SYSTEM_DEBUG_FAILED")

    @action(detail=False, methods=['get'], url_path='system-health')
    def system_health(self, request):
        try:
            health = AnalyticsService.get_system_health()
            return Response(health)
        except Exception as e:
            logger.error(f"System health error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_HEALTH_FAILED", http_status=status.HTTP_503_SERVICE_UNAVAILABLE)

    @action(detail=False, methods=['post'], url_path='maintenance')
    def maintenance(self, request):
        try:
            action_type = request.data.get("action")
            if not action_type:
                return Response({"success": False, "message": "Action is required."}, status=400)

            if not _is_reports_admin(request.user):
                logger.warning(
                    "Denied analytics maintenance for user=%s action=%s",
                    getattr(request.user, "username", "anonymous"),
                    action_type,
                )
                return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

            result = AnalyticsService.perform_maintenance(action=action_type)
            logger.info(
                "Analytics maintenance attempted by user=%s action=%s success=%s",
                getattr(request.user, "username", "anonymous"),
                action_type,
                bool(result.get("success")),
            )
            if result.get("success"):
                return Response(result)
            else:
                return Response(result, status=500)
        except Exception as e:
            logger.error(f"Maintenance error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_MAINTENANCE_FAILED")

    @action(detail=False, methods=['get'], url_path='control-tower')
    def control_tower(self, request):
        try:
            timeframe = request.query_params.get('timeframe', 'month')
            stats = AnalyticsService.get_control_tower_stats(timeframe=timeframe)
            try:
                stats["trading"] = _build_control_tower_trading_block(timeframe=timeframe)
            except Exception as trading_exc:
                logger.warning("Trading block injection failed: %s", str(trading_exc))
                stats["trading"] = _empty_trading_block()
            try:
                stats["procurement"] = _build_control_tower_procurement_block()
            except Exception as proc_exc:
                logger.warning("Procurement block injection failed: %s", str(proc_exc))
                stats["procurement"] = _empty_procurement_block()
            return Response(stats)
        except Exception as e:
            logger.error(f"Control tower error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_CONTROL_TOWER_FAILED")

    @action(detail=False, methods=['get'], url_path='kpis')
    def kpis(self, request):
        try:
            user = request.user
            role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
            is_master = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser
            
            wc_ids = None
            if not is_master and role_code == 'WORK_CENTER_MANAGER':
                 from apps.users.models import WorkCenterAssignment
                 wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))

            metrics = KPIService.get_real_metrics(work_center_ids=wc_ids)
            return Response(metrics)
        except Exception as e:
            logger.error(f"KPI error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_KPI_FAILED")

    @action(detail=False, methods=['get'], url_path='factory-tree')
    def factory_tree(self, request):
        try:
            tree = FactoryOverviewService.get_visual_tree()
            return Response(tree)
        except Exception as e:
            logger.error(f"Factory tree error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_FACTORY_TREE_FAILED")

    @action(detail=False, methods=['get'], url_path='factory-summary')
    def factory_summary(self, request):
        try:
            summary = FactoryOverviewService.get_summary()
            return Response(summary)
        except Exception as e:
            logger.error(f"Factory summary error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_FACTORY_SUMMARY_FAILED")

    @action(detail=False, methods=['get'], url_path='operational-logs')
    def operational_logs(self, request):
        try:
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "operational_logs.read")
            filter_type = request.query_params.get('type', 'all')
            limit = _bounded_int(
                request.query_params.get('limit', 100),
                default=100,
                minimum=1,
                maximum=500,
            )
            start_date = request.query_params.get('start_date') or request.query_params.get('date_from')
            end_date = request.query_params.get('end_date') or request.query_params.get('date_to')
            logs = ReportingService.get_operational_logs(filter_type, limit, start_date, end_date)
            return Response(logs)
        except Exception as e:
            logger.error(f"Operational logs error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_OPERATIONAL_LOGS_FAILED")

    @action(detail=False, methods=['get'], url_path='daily-production')
    def daily_production(self, request):
        try:
            days = _bounded_int(request.query_params.get('days', 30), default=30, minimum=1, maximum=120)
            data = ReportingService.get_daily_production(days)
            return Response(data)
        except Exception as e:
            logger.error(f"Daily production error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_DAILY_PRODUCTION_FAILED")

    @action(detail=False, methods=['get'], url_path='stock-overview')
    def stock_overview(self, request):
        try:
            data = ReportingService.get_stock_overview()
            return Response(data)
        except Exception as e:
            logger.error(f"Stock overview error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_STOCK_OVERVIEW_FAILED")

    @action(detail=False, methods=['get'], url_path='stock-by-sku')
    def stock_by_sku(self, request):
        try:
            data = ReportingService.get_stock_by_sku()
            return Response(data)
        except Exception as e:
            logger.error(f"Stock by SKU error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_STOCK_BY_SKU_FAILED")

    @action(detail=False, methods=['get'], url_path='wc-performance')
    def wc_performance(self, request):
        try:
            user = request.user
            role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
            is_master = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser
            
            wc_ids = None
            if not is_master and role_code == 'WORK_CENTER_MANAGER':
                 from apps.users.models import WorkCenterAssignment
                 wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))

            data = ReportingService.get_wc_performance(work_center_ids=wc_ids)
            return Response(data)
        except Exception as e:
            logger.error(f"WC performance error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_WC_PERFORMANCE_FAILED")

    @action(detail=False, methods=['get'], url_path='scrap-analysis')
    def scrap_analysis(self, request):
        try:
            days = _bounded_int(request.query_params.get('days', 30), default=30, minimum=1, maximum=120)
            data = ReportingService.get_scrap_analysis(days)
            return Response(data)
        except Exception as e:
            logger.error(f"Scrap analysis error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_SCRAP_ANALYSIS_FAILED")

    @action(detail=False, methods=['get'], url_path='downtime-analysis')
    def downtime_analysis(self, request):
        try:
            days = _bounded_int(request.query_params.get('days', 30), default=30, minimum=1, maximum=120)
            data = ReportingService.get_downtime_analysis(days)
            return Response(data)
        except Exception as e:
            logger.error(f"Downtime analysis error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_DOWNTIME_ANALYSIS_FAILED")

    @action(detail=False, methods=['get'], url_path='material-consumption')
    def material_consumption(self, request):
        try:
            days = _bounded_int(request.query_params.get('days', 30), default=30, minimum=1, maximum=120)
            data = ReportingService.get_material_consumption(days)
            return Response(data)
        except Exception as e:
            logger.error(f"Material consumption error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_MATERIAL_CONSUMPTION_FAILED")

    @action(detail=False, methods=['get'], url_path='order-tracking')
    def order_tracking(self, request):
        try:
            order_id = request.query_params.get('order_id')
            if not order_id:
                return Response({"error": "order_id is required"}, status=status.HTTP_400_BAD_REQUEST)
                
            data = AnalyticsService.get_order_tracking(order_id)
            return Response(data)
        except Exception as e:
            logger.error(f"Order tracking error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_ORDER_TRACKING_FAILED")

    @action(detail=False, methods=['get'], url_path=r'orders/(?P<order_id>[^/.]+)/tracking')
    def order_tracking_for_order(self, request, order_id=None):
        try:
            if not order_id:
                return Response({"error": "order_id is required"}, status=status.HTTP_400_BAD_REQUEST)
            data = AnalyticsService.get_order_tracking(order_id)
            return Response(data)
        except Exception as e:
            logger.error(f"Order tracking error ({order_id}): {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_ORDER_TRACKING_FAILED")

    @action(detail=False, methods=['get'], url_path='trace')
    def trace_lookup(self, request):
        try:
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "trace_lookup.read")
            query = (request.query_params.get("q") or "").strip()
            if not query:
                return Response({"error": "q query param is required"}, status=status.HTTP_400_BAD_REQUEST)
            data = AnalyticsService.get_trace_lookup(query)
            if data.get("error"):
                return Response(data, status=status.HTTP_404_NOT_FOUND)
            return Response(data)
        except Exception as e:
            logger.error(f"Trace lookup error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_TRACE_LOOKUP_FAILED")

    @action(detail=False, methods=['get'], url_path='audit-console')
    def audit_console(self, request):
        try:
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "audit_console.read")
            return Response(ReportingService.get_audit_console())
        except Exception as e:
            logger.error(f"Audit console error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_AUDIT_CONSOLE_FAILED")

    @action(detail=False, methods=['get'], url_path='audit-ledger')
    def audit_ledger(self, request):
        try:
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "audit_ledger.read")
            return Response(ReportingService.get_audit_ledger(request.query_params))
        except Exception as e:
            logger.error(f"Audit ledger error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_AUDIT_LEDGER_FAILED")

    @action(detail=False, methods=['get'], url_path='audit-ledger/(?P<event_id>[^/.]+)')
    def audit_event_detail(self, request, event_id=None):
        try:
            if not _is_reports_admin(request.user):
                return _reports_admin_forbidden_response(request.user, "audit_event_detail.read")
            data = ReportingService.get_audit_event_detail(event_id)
            if data.get("error"):
                return Response(data, status=status.HTTP_404_NOT_FOUND)
            return Response(data)
        except Exception as e:
            logger.error(f"Audit event detail error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_AUDIT_EVENT_DETAIL_FAILED")

    @action(detail=False, methods=['get'], url_path='sales-dashboard')
    def sales_dashboard(self, request):
        try:
            stats = AnalyticsService.get_sales_dashboard_stats()
            return Response(stats)
        except Exception as e:
            logger.error(f"Sales dashboard error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_SALES_DASHBOARD_FAILED")

    @action(detail=False, methods=['get'], url_path='planner-dashboard')
    def planner_dashboard(self, request):
        try:
            cache_key = "analytics:planner-dashboard:v2"
            if str(request.query_params.get("refresh") or "").lower() not in {"1", "true", "yes"}:
                cached = cache.get(cache_key)
                if cached is not None:
                    return Response(cached)
            stats = AnalyticsService.get_planner_dashboard_stats()
            cache.set(cache_key, stats, 45)
            return Response(stats)
        except Exception as e:
            logger.error(f"Planner dashboard error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_PLANNER_DASHBOARD_FAILED")

    @action(detail=False, methods=['get'], url_path='wcm-dashboard')
    def wcm_dashboard(self, request):
        try:
            user = request.user
            role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
            is_master = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser

            wc_ids = None
            if not is_master and role_code == 'WORK_CENTER_MANAGER':
                from apps.users.models import WorkCenterAssignment

                wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))

            stats = AnalyticsService.get_wcm_dashboard_stats(work_center_ids=wc_ids)
            return Response(stats)
        except Exception as e:
            logger.error(f"WCM dashboard error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_WCM_DASHBOARD_FAILED")

    @action(detail=False, methods=['get'], url_path='catalog')
    def catalog(self, request):
        try:
            catalog = ReportingService.get_report_catalog(request.user)
            return Response(catalog)
        except Exception as e:
            logger.error(f"Catalog error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_CATALOG_FAILED")

    @action(detail=False, methods=['get'], url_path='dashboard-summary')
    def dashboard_summary(self, request):
        try:
            filters = {
                "plant": request.query_params.get("plant"),
                "date_from": request.query_params.get("date_from"),
                "date_to": request.query_params.get("date_to"),
            }
            stats = ReportingService.get_dashboard_summary(filters)
            return Response(stats)
        except Exception as e:
            logger.error(f"Dashboard summary error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_DASHBOARD_SUMMARY_FAILED")

    @action(detail=False, methods=['get'], url_path='dashboard-summary/export-pdf')
    def dashboard_summary_export_pdf(self, request):
        try:
            filters = {
                "plant": request.query_params.get("plant"),
                "date_from": request.query_params.get("date_from"),
                "date_to": request.query_params.get("date_to"),
            }
            rendered = AnalyticsPDFExportService.export_dashboard_summary_pdf(filters)
            return FileResponse(BytesIO(rendered.content), filename=rendered.file_name, content_type="application/pdf", as_attachment=True)
        except Exception as exc:
            logger.error("Dashboard summary export failed: %s", str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_DASHBOARD_EXPORT_FAILED")

    @action(detail=False, methods=['get'], url_path='scrap-center')
    def scrap_center(self, request):
        try:
            payload = {
                "plant": request.query_params.get("plant"),
                "date_from": parse_date(request.query_params.get("date_from")) if request.query_params.get("date_from") else None,
                "date_to": parse_date(request.query_params.get("date_to")) if request.query_params.get("date_to") else None,
                "process": request.query_params.get("process"),
                "machine": request.query_params.get("machine"),
            }
            data = ReportingService.get_scrap_center(payload)
            return Response(data)
        except Exception as e:
            logger.error(f"Scrap center error: {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_SCRAP_CENTER_FAILED")


    @action(detail=False, methods=['get'], url_path='reports/production')
    def report_production(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("production", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/oee')
    def report_oee(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("oee", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/downtime')
    def report_downtime(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("downtime", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/scrap')
    def report_scrap(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("scrap", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/inventory')
    def report_inventory(self, request):
        try:
            filters = request.query_params.dict()
            data = ReportService.get_report_tab("inventory", filters)
            return Response(data)
        except Exception as e:
            logger.error(f"Inventory report error: {str(e)}", exc_info=True)
            # Non-fatal degraded payload: inventory UI should remain usable even when
            # analytics aggregation fails.
            return Response(
                {
                    "tab": "inventory",
                    "degraded": True,
                    "message": "Inventory report is temporarily unavailable.",
                    "summary": {
                        "total_weight_kg": 0,
                        "total_items": 0,
                        "estimated_value": None,
                        "valuation_rate_coverage_pct": 0,
                        "valuation_missing_rate_weight_kg": 0,
                        "valuation_missing_rate_items": 0,
                        "valuation_materials_with_rate": 0,
                        "valuation_materials_total": 0,
                        "aged_stock_items": 0,
                        "aged_stock_weight_kg": 0,
                        "bulk_stock_kg": 0,
                        "bulk_items": 0,
                    },
                    "aging": [],
                    "by_stage": [],
                    "by_material": [],
                    "by_location": [],
                },
                status=status.HTTP_200_OK,
            )

    @action(detail=False, methods=['get'], url_path='reports/sales')
    def report_sales(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("sales", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/mrp')
    def report_mrp(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("mrp", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/operator')
    def report_operator(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("operator", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/costing')
    def report_costing(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("costing", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/dispatch')
    def report_dispatch(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("dispatch", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/material-variance')
    def report_material_variance(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("material-variance", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/ink-intelligence')
    def report_ink_intelligence(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("ink-intelligence", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/shift-performance')
    def report_shift_performance(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("shift-performance", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reports/trading')
    def report_trading(self, request):
        filters = request.query_params.dict()
        data = ReportService.get_report_tab("trading", filters)
        return Response(data)

    @action(detail=False, methods=['get'], url_path=r'reports/(?P<tab>[^/.]+)/export-pdf')
    def report_tab_export_pdf(self, request, tab=None):
        try:
            filters = request.query_params.dict()
            rendered = AnalyticsPDFExportService.export_report_tab_pdf(tab or "report", filters)
            return FileResponse(BytesIO(rendered.content), filename=rendered.file_name, content_type="application/pdf", as_attachment=True)
        except Exception as exc:
            logger.error("Reports tab export failed (%s): %s", tab, str(exc), exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_EXPORT_FAILED")

    @action(detail=False, methods=['get'], url_path=r'reports/(?P<tab>[^/.]+)')
    def report_tab(self, request, tab=None):
        try:
            payload = request.query_params.dict()
            data = ReportService.get_report_tab(tab, payload)
            return Response(data)
        except Exception as e:
            logger.error(f"Reports tab error ({tab}): {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_REPORT_TAB_FAILED")

    @action(detail=False, methods=['get'], url_path=r'reports/machine/(?P<machine_id>[^/.]+)')
    def machine_report(self, request, machine_id=None):
        try:
            filters = {
                "date_from": parse_date(request.query_params.get("date_from")) if request.query_params.get("date_from") else None,
                "date_to": parse_date(request.query_params.get("date_to")) if request.query_params.get("date_to") else None,
            }
            data = ReportingService.get_machine_performance_report(machine_id, filters)
            return Response(data)
        except Exception as e:
            logger.error(f"Machine report error ({machine_id}): {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_MACHINE_REPORT_FAILED")

    @action(detail=False, methods=['get'], url_path=r'reports/workcenter/(?P<wc_id>[^/.]+)')
    def workcenter_report(self, request, wc_id=None):
        try:
            filters = {
                "date_from": parse_date(request.query_params.get("date_from")) if request.query_params.get("date_from") else None,
                "date_to": parse_date(request.query_params.get("date_to")) if request.query_params.get("date_to") else None,
            }
            data = ReportingService.get_workcenter_performance_report(wc_id, filters)
            return Response(data)
        except Exception as e:
            logger.error(f"WC report error ({wc_id}): {str(e)}", exc_info=True)
            return _error_response(code="ANALYTICS_WORKCENTER_REPORT_FAILED")

# Trigger reload
