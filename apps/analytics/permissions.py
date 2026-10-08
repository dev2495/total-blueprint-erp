"""Authorization shared by analytics JSON and PDF entry points."""
from rest_framework.permissions import BasePermission

from apps.users.permission_service import PermissionService
from apps.users.role_catalog import get_canonical_role_code


REPORT_PERMISSIONS = {
    "production": {"production.view", "page.analytics.reports_production.view"},
    "oee": {"production.view", "page.analytics.reports_oee.view"},
    "downtime": {"production.view", "page.analytics.reports_downtime.view"},
    "scrap": {"production.view", "page.analytics.reports_scrap.view"},
    "inventory": {"inventory.view", "page.analytics.reports_inventory.view"},
    "inventory-lineage": {"inventory.view", "page.analytics.reports_inventory.view"},
    "interplant": {"inventory.view", "logistics.view", "page.analytics.reports_interplant.view"},
    "sales": {"sales.view", "page.analytics.reports_sales.view"},
    "mrp": {"mrp.view", "page.analytics.reports_mrp.view"},
    "operator": {"production.view", "page.analytics.reports_operator.view"},
    "costing": {"costing.view", "page.analytics.reports_costing.view"},
    "dispatch": {"logistics.view", "page.analytics.reports_dispatch.view"},
    "material-variance": {"mrp.view", "page.analytics.reports_mrp.view"},
    "ink-intelligence": {"production.view", "page.analytics.reports_mrp.view"},
    "shift-performance": {"production.view", "page.analytics.reports_production.view"},
    "trading": {"sales.view"},
}

ACTION_PERMISSIONS = {
    "capability_matrix": {"factory.view", "production.view"},
    "system_debug": {"ops.view"},
    "system_health": {"ops.view"},
    "control_tower": {"page.analytics.kpis.view", "page.analytics.kpi.view", "page.dashboard.owner.view"},
    "kpis": {"factory.view", "production.view", "page.factory.overview.view"},
    "factory_tree": {"factory.view", "page.factory.overview.view"},
    "factory_summary": {"factory.view", "page.factory.overview.view"},
    "daily_production": {"production.view"},
    "stock_overview": {"inventory.view", "page.analytics.inventory_health.view"},
    "stock_by_sku": {"inventory.view", "page.analytics.inventory_health.view"},
    "wc_performance": {"factory.view", "production.view"},
    "scrap_analysis": {"factory.view", "production.view", "page.factory.overview.view"},
    "downtime_analysis": {"factory.view", "production.view", "page.factory.overview.view"},
    "material_consumption": {"inventory.view", "production.view"},
    "order_tracking": {"sales.view"},
    "order_tracking_for_order": {"sales.view"},
    "sales_dashboard": {"sales.view", "page.dashboard.sales.view"},
    "planner_dashboard": {"production.view", "page.dashboard.planner.view"},
    "wcm_dashboard": {"production.view", "page.dashboard.work_center.view"},
    "catalog": {"factory.view", "production.view", "inventory.view", "logistics.view", "sales.view", "mrp.view", "costing.view", "gate.reports"},
    "dashboard_summary": {"page.analytics.home.view"},
    "dashboard_summary_export_pdf": {"page.analytics.home.view"},
    "scrap_center": {"production.view", "page.analytics.scrap.view"},
    "machine_report": {"factory.view", "production.view"},
    "workcenter_report": {"factory.view", "production.view"},
}

ADMIN_ACTIONS = {
    "report_distributions", "send_report_distribution", "maintenance",
    "operational_logs", "trace_lookup", "audit_console", "audit_ledger", "audit_event_detail",
}
RUN_ACTIONS = {"report_runs", "report_run_preview_pdf", "report_run_download_pdf", "report_run_download_detail"}


class AnalyticsAccessPermission(BasePermission):
    """Require an entitlement, preserving shared department dashboards."""

    message = "Forbidden"

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        actual = get_canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        effective = get_canonical_role_code(getattr(user, "effective_role_code", actual))
        if "WATCHMAN" in {actual, effective}:
            return False
        if PermissionService.is_gate_master(user):
            return True

        granted = set(PermissionService.get_user_permissions(user))
        action = getattr(view, "action", "")
        if action in ADMIN_ACTIONS:
            return False
        if action in RUN_ACTIONS:
            # Each saved artifact applies its report's object-level check in
            # the view, so a gate-only delegate cannot read other report runs.
            return "gate.reports" in granted

        if action in {"report_tab", "report_tab_export_pdf"}:
            tab = str(view.kwargs.get("tab") or "").strip().lower()
        elif action.startswith("report_"):
            tab = action.removeprefix("report_").replace("_", "-")
        else:
            tab = None

        if tab == "gate":
            # General wildcard/page grants do not expose private gate reports.
            return "gate.reports" in granted
        permitted = REPORT_PERMISSIONS.get(tab) if tab is not None else ACTION_PERMISSIONS.get(action)
        if permitted is None:
            return False
        return bool(granted & (permitted | {"analytics.view", "*"}))
