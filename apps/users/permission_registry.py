from functools import lru_cache
from typing import Dict, Iterable, List, Optional, Set, Tuple

from .role_catalog import get_canonical_role_code


PUBLIC_ENDPOINT_PREFIXES = (
    "/api/health/live",
    "/api/health/ready",
    "/api/health/",
    "/api/auth/login",
    "/api/auth/token/refresh",
    "/api/auth/csrf",
    "/api/users/login",
    "/api/users/token/refresh",
    "/api/users/csrf",
)

# Ordered list; first match wins.
ROUTE_PERMISSION_MAP: List[Tuple[str, str, str]] = [
    ("GET", "/api/dashboard/", "dashboard.view"),
    ("GET", "/api/analytics/", "analytics.view"),
    ("POST", "/api/analytics/", "analytics.manage"),
    ("GET", "/api/master/", "master.view"),
    ("POST", "/api/master/", "master.manage"),
    ("PUT", "/api/master/", "master.manage"),
    ("PATCH", "/api/master/", "master.manage"),
    ("DELETE", "/api/master/", "master.manage"),
    ("GET", "/api/recipes/", "master.view"),
    ("POST", "/api/recipes/", "master.manage"),
    ("PUT", "/api/recipes/", "master.manage"),
    ("PATCH", "/api/recipes/", "master.manage"),
    ("DELETE", "/api/recipes/", "master.manage"),
    ("GET", "/api/templates/", "templates.view"),
    ("POST", "/api/templates/", "templates.manage"),
    ("PUT", "/api/templates/", "templates.manage"),
    ("PATCH", "/api/templates/", "templates.manage"),
    ("DELETE", "/api/templates/", "templates.manage"),
    ("GET", "/api/routing/", "routing.view"),
    ("POST", "/api/routing/", "routing.manage"),
    ("PUT", "/api/routing/", "routing.manage"),
    ("PATCH", "/api/routing/", "routing.manage"),
    ("DELETE", "/api/routing/", "routing.manage"),
    ("GET", "/api/engineering/", "engineering.view"),
    ("POST", "/api/engineering/", "engineering.manage"),
    ("PUT", "/api/engineering/", "engineering.manage"),
    ("PATCH", "/api/engineering/", "engineering.manage"),
    ("DELETE", "/api/engineering/", "engineering.manage"),
    ("GET", "/api/tooling/", "tooling.view"),
    ("POST", "/api/tooling/", "tooling.manage"),
    ("PUT", "/api/tooling/", "tooling.manage"),
    ("PATCH", "/api/tooling/", "tooling.manage"),
    ("DELETE", "/api/tooling/", "tooling.manage"),
    # NOTE: Earlier iterations tried to gate quote approval with a dedicated
    # `sales.quote.approve` code at /api/sales/quotations/approve. The route
    # resolver does prefix-based startswith matching, so that prefix could not
    # differentiate /approve/ from any other detail-route action on the same
    # ViewSet (and would never have matched the `/{id}/approve/` URL anyway).
    # For V1 we accept that quote approval is gated by the broader sales.manage
    # permission like the other write actions — OWNER/ADMIN/SUPER_ADMIN already
    # wildcard, SALES already has sales.manage. A method-aware exact-path
    # matcher for the dedicated permission can land in V2.
    ("GET", "/api/sales/", "sales.view"),
    ("POST", "/api/sales/", "sales.manage"),
    ("PUT", "/api/sales/", "sales.manage"),
    ("PATCH", "/api/sales/", "sales.manage"),
    ("DELETE", "/api/sales/", "sales.manage"),
    ("GET", "/api/factory/", "factory.view"),
    ("POST", "/api/factory/", "factory.manage"),
    ("PUT", "/api/factory/", "factory.manage"),
    ("PATCH", "/api/factory/", "factory.manage"),
    ("DELETE", "/api/factory/", "factory.manage"),
    ("GET", "/api/production/", "production.view"),
    ("POST", "/api/production/", "production.manage"),
    ("PUT", "/api/production/", "production.manage"),
    ("PATCH", "/api/production/", "production.manage"),
    ("DELETE", "/api/production/", "production.manage"),
    ("GET", "/api/inventory/adjustments/", "inventory.adjust"),
    ("POST", "/api/inventory/adjustments/", "inventory.adjust"),
    ("PUT", "/api/inventory/adjustments/", "inventory.adjust"),
    ("PATCH", "/api/inventory/adjustments/", "inventory.adjust"),
    ("DELETE", "/api/inventory/adjustments/", "inventory.adjust"),
    ("GET", "/api/inventory/audit/", "inventory.audit.view"),
    ("POST", "/api/inventory/audit/closing-preview", "inventory.audit.view"),
    ("POST", "/api/inventory/audit/stock-card", "inventory.audit.view"),
    ("POST", "/api/inventory/audit/periods/start", "inventory.period.close"),
    ("POST", "/api/inventory/audit/periods/", "inventory.audit.manage"),
    ("POST", "/api/inventory/audit/batches/", "inventory.audit.manage"),
    ("PUT", "/api/inventory/audit/batches/", "inventory.audit.manage"),
    ("PATCH", "/api/inventory/audit/batches/", "inventory.audit.manage"),
    ("DELETE", "/api/inventory/audit/batches/", "inventory.audit.manage"),
    ("GET", "/api/inventory/", "inventory.view"),
    ("POST", "/api/inventory/", "inventory.manage"),
    ("PUT", "/api/inventory/", "inventory.manage"),
    ("PATCH", "/api/inventory/", "inventory.manage"),
    ("DELETE", "/api/inventory/", "inventory.manage"),
    ("GET", "/api/mrp/", "mrp.view"),
    ("POST", "/api/mrp/", "mrp.manage"),
    ("PUT", "/api/mrp/", "mrp.manage"),
    ("PATCH", "/api/mrp/", "mrp.manage"),
    ("DELETE", "/api/mrp/", "mrp.manage"),
    ("GET", "/api/costing/", "costing.view"),
    ("POST", "/api/costing/", "costing.manage"),
    ("PUT", "/api/costing/", "costing.manage"),
    ("PATCH", "/api/costing/", "costing.manage"),
    ("DELETE", "/api/costing/", "costing.manage"),
    ("GET", "/api/procurement/", "procurement.view"),
    ("POST", "/api/procurement/", "procurement.manage"),
    ("PUT", "/api/procurement/", "procurement.manage"),
    ("PATCH", "/api/procurement/", "procurement.manage"),
    ("DELETE", "/api/procurement/", "procurement.manage"),
    ("GET", "/api/ops/", "ops.view"),
    ("POST", "/api/ops/", "ops.manage"),
    ("PUT", "/api/ops/", "ops.manage"),
    ("PATCH", "/api/ops/", "ops.manage"),
    ("DELETE", "/api/ops/", "ops.manage"),
    ("GET", "/api/users/me/", "users.self_manage"),
    ("POST", "/api/users/logout/", "users.self_manage"),
    ("POST", "/api/users/change-password/", "users.self_manage"),
    ("PATCH", "/api/users/profile-change-requests/", "users.manage"),
    ("GET", "/api/users/profile-change-requests/", "users.self_manage"),
    ("POST", "/api/users/profile-change-requests/", "users.self_manage"),
    ("GET", "/api/users/users/", "users.view"),
    ("POST", "/api/users/users/", "users.manage"),
    ("PUT", "/api/users/users/", "users.manage"),
    ("PATCH", "/api/users/users/", "users.manage"),
    ("DELETE", "/api/users/users/", "users.manage"),
    ("POST", "/api/users/notifications/rules/upsert", "notifications.manage"),
    ("POST", "/api/users/notifications/role-signoffs/upsert", "rbac.manage"),
    ("GET", "/api/users/notifications/", "notifications.view"),
    ("POST", "/api/users/notifications/", "notifications.view"),
    ("GET", "/api/auth/users/", "users.view"),
    ("POST", "/api/auth/users/", "users.manage"),
    ("PUT", "/api/auth/users/", "users.manage"),
    ("PATCH", "/api/auth/users/", "users.manage"),
    ("DELETE", "/api/auth/users/", "users.manage"),
    ("POST", "/api/auth/notifications/rules/upsert", "notifications.manage"),
    ("POST", "/api/auth/notifications/role-signoffs/upsert", "rbac.manage"),
    ("GET", "/api/auth/notifications/", "notifications.view"),
    ("POST", "/api/auth/notifications/", "notifications.view"),
    ("GET", "/api/auth/me/", "users.self_manage"),
    ("POST", "/api/auth/logout/", "users.self_manage"),
    ("POST", "/api/auth/change-password/", "users.self_manage"),
    ("PATCH", "/api/auth/profile-change-requests/", "users.manage"),
    ("GET", "/api/auth/profile-change-requests/", "users.self_manage"),
    ("POST", "/api/auth/profile-change-requests/", "users.self_manage"),
    ("GET", "/api/users/roles/", "rbac.view"),
    ("POST", "/api/users/roles/", "rbac.manage"),
    ("PUT", "/api/users/roles/", "rbac.manage"),
    ("PATCH", "/api/users/roles/", "rbac.manage"),
    ("DELETE", "/api/users/roles/", "rbac.manage"),
    ("GET", "/api/auth/roles/", "rbac.view"),
    ("POST", "/api/auth/roles/", "rbac.manage"),
    ("PUT", "/api/auth/roles/", "rbac.manage"),
    ("PATCH", "/api/auth/roles/", "rbac.manage"),
    ("DELETE", "/api/auth/roles/", "rbac.manage"),
    # System / company-wide configuration (singleton CompanyProfile etc.)
    ("GET", "/api/system/company-profile", "system.view"),
    ("GET", "/api/system/", "system.view"),
    ("POST", "/api/system/", "system.manage"),
    ("PUT", "/api/system/", "system.manage"),
    ("PATCH", "/api/system/", "system.manage"),
    ("DELETE", "/api/system/", "system.manage"),
]


FRONTEND_PAGE_PERMISSION_CATALOG: List[Dict[str, str]] = [
    {"permission": "page.analytics.home.view", "route": "/analytics", "label": "Analytics home"},
    {"permission": "page.analytics.kpis.view", "route": "/analytics/kpis", "label": "KPI dashboard"},
    {"permission": "page.analytics.kpi.view", "route": "/analytics/kpi", "label": "KPI report"},
    {"permission": "page.analytics.costing.view", "route": "/analytics/costing", "label": "Costing analytics"},
    {"permission": "page.analytics.mrp.view", "route": "/analytics/mrp", "label": "MRP analytics"},
    {"permission": "page.analytics.inventory_history.view", "route": "/analytics/inventory-history", "label": "Inventory history"},
    {"permission": "page.analytics.inventory_health.view", "route": "/analytics/inventory-health", "label": "Inventory health"},
    {"permission": "page.analytics.process_rates.view", "route": "/analytics/process-rates", "label": "Process rates"},
    {"permission": "page.analytics.scrap.view", "route": "/analytics/scrap", "label": "Scrap analytics"},
    {"permission": "page.analytics.reports.view", "route": "/analytics/reports", "label": "Reports hub"},
    {"permission": "page.analytics.reports_sales.view", "route": "/analytics/reports/sales", "label": "Sales report"},
    {"permission": "page.analytics.reports_production.view", "route": "/analytics/reports/production", "label": "Production report"},
    {"permission": "page.analytics.reports_inventory.view", "route": "/analytics/reports/inventory", "label": "Inventory report"},
    {"permission": "page.analytics.reports_dispatch.view", "route": "/analytics/reports/dispatch", "label": "Dispatch report"},
    {"permission": "page.analytics.reports_mrp.view", "route": "/analytics/reports/mrp", "label": "MRP report"},
    {"permission": "page.analytics.reports_costing.view", "route": "/analytics/reports/costing", "label": "Costing report"},
    {"permission": "page.analytics.reports_oee.view", "route": "/analytics/reports/oee", "label": "OEE report"},
    {"permission": "page.analytics.reports_downtime.view", "route": "/analytics/reports/downtime", "label": "Downtime report"},
    {"permission": "page.analytics.reports_operator.view", "route": "/analytics/reports/operator", "label": "Operator report"},
    {"permission": "page.analytics.reports_interplant.view", "route": "/analytics/reports/interplant", "label": "Inter-plant report"},
    {"permission": "page.analytics.reports_scrap.view", "route": "/analytics/reports/scrap", "label": "Scrap report"},
    {"permission": "page.dashboard.owner.view", "route": "/dashboard/owner", "label": "Owner dashboard"},
    {"permission": "page.dashboard.admin.view", "route": "/dashboard/admin", "label": "Admin console"},
    {"permission": "page.dashboard.planner.view", "route": "/dashboard/planner", "label": "Planner dashboard"},
    {"permission": "page.dashboard.work_center.view", "route": "/dashboard/work-center", "label": "WCM dashboard"},
    {"permission": "page.dashboard.sales.view", "route": "/dashboard/sales", "label": "Sales dashboard"},
    {"permission": "page.dashboard.inventory.view", "route": "/dashboard/inventory", "label": "Inventory dashboard"},
    {"permission": "page.dashboard.logistics.view", "route": "/dashboard/logistics", "label": "Logistics dashboard"},
    {"permission": "page.dashboard.engineering.view", "route": "/dashboard/engineering", "label": "Engineering dashboard"},
    {"permission": "page.dashboard.operator.view", "route": "/dashboard/operator", "label": "Operator dashboard"},
    {"permission": "page.production.planner.view", "route": "/production/planner", "label": "Production planner"},
    {"permission": "page.production.control_tower.view", "route": "/dashboard/planner/control-tower/command", "label": "Control tower command"},
    {"permission": "page.production.plan_queue.view", "route": "/dashboard/planner/control-tower/plan-queue", "label": "Plan queue"},
    {"permission": "page.production.live_production.view", "route": "/dashboard/planner/control-tower/live-production", "label": "Live production"},
    {"permission": "page.production.completed_trace.view", "route": "/dashboard/planner/control-tower/completed-trace", "label": "Completed trace"},
    {"permission": "page.production.stock_intelligence.view", "route": "/dashboard/planner/control-tower/stock-intelligence", "label": "Stock intelligence"},
    {"permission": "page.production.gang_builder.view", "route": "/dashboard/planner/control-tower/gang-builder", "label": "Gang builder"},
    {"permission": "page.production.stock_launcher.view", "route": "/production/planner/stock-launcher", "label": "Stock launcher"},
    {"permission": "page.production.heatmap.view", "route": "/production/planner/heatmap", "label": "Planner heatmap"},
    {"permission": "page.production.ink_control.view", "route": "/production/ink-control", "label": "Ink control"},
    {"permission": "page.production.machine_selector.view", "route": "/production/machine-selector", "label": "Machine selector"},
    {"permission": "page.production.work_center.view", "route": "/production/work-center", "label": "Work center terminal"},
    {"permission": "page.inventory.home.view", "route": "/inventory", "label": "Inventory workspace"},
    {"permission": "page.inventory.rolls.view", "route": "/inventory/rolls", "label": "Rolls workspace"},
    {"permission": "page.inventory.bulk.view", "route": "/inventory/bulk", "label": "Bulk workspace"},
    {"permission": "page.inventory.packaging.view", "route": "/inventory/packaging", "label": "Packaging workspace"},
    {"permission": "page.inventory.addons.view", "route": "/inventory/addons", "label": "Ink and adhesive inventory"},
    {"permission": "page.inventory.grn.view", "route": "/inventory/grn", "label": "Smart GRN"},
    {"permission": "page.inventory.grn_history.view", "route": "/inventory/grn-history", "label": "GRN history"},
    {"permission": "page.inventory.stock_lifecycle.view", "route": "/inventory/stock-lifecycle", "label": "Stock lifecycle"},
    {"permission": "page.inventory.count.view", "route": "/inventory/count", "label": "Physical count"},
    {"permission": "page.inventory.period.view", "route": "/inventory/period", "label": "Inventory period close"},
    {"permission": "page.inventory.ledger.view", "route": "/inventory/ledger", "label": "Stock ledger"},
    {"permission": "page.inventory.movements.view", "route": "/inventory/movements", "label": "Roll movements"},
    {"permission": "page.inventory.bulk_transactions.view", "route": "/inventory/bulk-transactions", "label": "Bulk transactions"},
    {"permission": "page.inventory.alerts.view", "route": "/inventory/alerts", "label": "Inventory alerts"},
    {"permission": "page.inventory.adjustments.view", "route": "/inventory/adjustments", "label": "Stock adjustments"},
    {"permission": "page.inventory.traceability.view", "route": "/inventory/traceability", "label": "Traceability"},
    {"permission": "page.inventory.inter_plant.view", "route": "/inventory/inter-plant", "label": "Inter-plant transfer"},
    {"permission": "page.inventory.job_work.view", "route": "/inventory/job-work", "label": "Job work"},
    {"permission": "page.inventory.vendors.view", "route": "/inventory/vendors", "label": "Inventory vendors"},
    {"permission": "page.logistics.packing.view", "route": "/logistics/packing", "label": "Packing yard"},
    {"permission": "page.logistics.packing_consumption.view", "route": "/logistics/packing/consumption", "label": "Packing consumption"},
    {"permission": "page.logistics.packing_audit.view", "route": "/logistics/packing/audit", "label": "Packing audit"},
    {"permission": "page.logistics.dispatch.view", "route": "/logistics/dispatch", "label": "Dispatch bay"},
    {"permission": "page.logistics.transit.view", "route": "/logistics/transit", "label": "Transit"},
    {"permission": "page.sales.orders.view", "route": "/sales/orders", "label": "Sales orders"},
    {"permission": "page.sales.order_create.view", "route": "/sales/orders/create", "label": "Create sales order"},
    {"permission": "page.sales.customers.view", "route": "/sales/customers", "label": "Customers"},
    {"permission": "page.sales.quotations.view", "route": "/sales/quotations", "label": "Quotations"},
    {"permission": "page.sales.trade_orders.view", "route": "/sales/trade-orders", "label": "Trade orders"},
    {"permission": "page.engineering.artworks.view", "route": "/engineering/artworks", "label": "Artwork"},
    {"permission": "page.engineering.approvals.view", "route": "/engineering/approvals", "label": "Engineering approvals"},
    {"permission": "page.engineering.cylinders.view", "route": "/engineering/cylinders", "label": "Cylinders"},
    {"permission": "page.engineering.routing.view", "route": "/engineering/routing", "label": "Routing"},
    {"permission": "page.engineering.route_dispatch.view", "route": "/engineering/route-dispatch", "label": "Route dispatch"},
    {"permission": "page.engineering.templates.view", "route": "/engineering/templates", "label": "Templates"},
    {"permission": "page.engineering.tooling.view", "route": "/engineering/tooling", "label": "Tooling"},
    {"permission": "page.factory.overview.view", "route": "/factory/overview", "label": "Factory overview"},
    {"permission": "page.factory.plants.view", "route": "/factory/plants", "label": "Plants"},
    {"permission": "page.factory.locations.view", "route": "/factory/locations", "label": "Locations"},
    {"permission": "page.factory.work_centers.view", "route": "/factory/work-centers", "label": "Work centers"},
    {"permission": "page.factory.machines.view", "route": "/factory/machines", "label": "Machines"},
    {"permission": "page.factory.processes.view", "route": "/factory/processes", "label": "Processes"},
    {"permission": "page.master.products.view", "route": "/master/products", "label": "Product masters"},
    {"permission": "page.master.commercial_families.view", "route": "/master/commercial-families", "label": "Commercial families"},
    {"permission": "page.master.film_families.view", "route": "/master/film-families", "label": "Film families"},
    {"permission": "page.master.film_variants.view", "route": "/master/film-variants", "label": "Film variants"},
    {"permission": "page.master.inks.view", "route": "/master/inks", "label": "Inks"},
    {"permission": "page.master.granules.view", "route": "/master/granules", "label": "Granules"},
    {"permission": "page.master.adhesives_solvents.view", "route": "/master/adhesives-solvents", "label": "Adhesives and solvents"},
    {"permission": "page.master.packaging.view", "route": "/master/packaging", "label": "Packaging catalog"},
    {"permission": "page.master.pod.view", "route": "/master/pod", "label": "POD catalog"},
    {"permission": "page.master.recipes.view", "route": "/master/recipes", "label": "Recipes"},
    {"permission": "page.master.vendors.view", "route": "/master/vendors", "label": "Vendors"},
    {"permission": "page.procurement.purchase_orders.view", "route": "/procurement/purchase-orders", "label": "Purchase orders"},
    {"permission": "page.system.users.view", "route": "/system/users", "label": "Users"},
    {"permission": "page.system.role_matrix.view", "route": "/system/role-matrix", "label": "Role matrix"},
    {"permission": "page.system.governance.view", "route": "/system/governance", "label": "Governance"},
    {"permission": "page.system.audit.view", "route": "/system/audit", "label": "System audit"},
    {"permission": "page.system.reason_codes.view", "route": "/system/reason-codes", "label": "Reason codes"},
    {"permission": "page.system.reorder_policy.view", "route": "/system/reorder-policy", "label": "Reorder policy"},
    {"permission": "page.system.report_center.view", "route": "/system/report-center", "label": "Report center"},
    {"permission": "page.system.settings.view", "route": "/system/settings", "label": "System settings"},
    {"permission": "page.system.company_profile.view", "route": "/system/company-profile", "label": "Company profile"},
    {"permission": "page.profile.view", "route": "/profile", "label": "Profile"},
]


ROLE_PERMISSION_MATRIX: Dict[str, List[str]] = {
    "OWNER": ["*"],
    "SUPER_ADMIN": ["*"],
    "ADMIN": ["*"],
    "SALES": [
        "users.self_manage",
        "sales.view",
        "sales.manage",
        "dashboard.view",
        "notifications.view",
        "master.view",
        "templates.view",
        "engineering.view",
        "factory.view",
        "analytics.view",
    ],
    "ENGINEERING": [
        "users.self_manage",
        "engineering.view",
        "engineering.manage",
        "templates.view",
        "templates.manage",
        "routing.view",
        "routing.manage",
        "master.view",
        "master.manage",
        "dashboard.view",
        "notifications.view",
        "factory.view",
    ],
    "PLANNER": [
        "users.self_manage",
        "production.view",
        "production.manage",
        "inventory.view",
        "inventory.audit.view",
        "mrp.view",
        "mrp.manage",
        "dashboard.view",
        "analytics.view",
        "sales.view",
        "master.view",
        "templates.view",
        "engineering.view",
        "notifications.view",
        "factory.view",
    ],
    "WORK_CENTER_MANAGER": [
        "users.self_manage",
        "production.view",
        "production.manage",
        "inventory.view",
        "master.view",
        "templates.view",
        "dashboard.view",
        "analytics.view",
        "notifications.view",
        "factory.view",
    ],
    "STORE": [
        "users.self_manage",
        "inventory.view",
        "inventory.manage",
        "inventory.adjust",
        "inventory.audit.view",
        "inventory.audit.manage",
        "factory.view",
        "master.view",
        "mrp.view",
        "dashboard.view",
        "notifications.view",
        "sales.view",
        "procurement.view",
        "procurement.manage",
    ],
    "DISPATCH": [
        "users.self_manage",
        "inventory.view",
        "inventory.manage",
        "sales.view",
        "production.view",
        "factory.view",
        "master.view",
        "dashboard.view",
        "notifications.view",
    ],
    "PLANT_MANAGER": [
        "users.self_manage",
        "dashboard.view",
        "analytics.view",
        "production.view",
        "inventory.view",
        "inventory.adjust",
        "inventory.audit.view",
        "factory.view",
        "sales.view",
        "master.view",
        "templates.view",
        "engineering.view",
        "notifications.view",
        "procurement.view",
    ],
}


def _candidate_paths(path: str) -> List[str]:
    raw_path = str(path or "").strip()
    if not raw_path:
        return [""]

    canonical = raw_path.split("?", 1)[0].strip() or "/"
    if not canonical.startswith("/"):
        canonical = f"/{canonical}"

    base = canonical.rstrip("/") or "/"
    with_slash = base if base == "/" else f"{base}/"

    candidates: List[str] = []
    for value in (canonical, base, with_slash):
        if value not in candidates:
            candidates.append(value)
    return candidates


def is_public_endpoint(path: str) -> bool:
    return any(candidate.startswith(prefix) for candidate in _candidate_paths(path) for prefix in PUBLIC_ENDPOINT_PREFIXES)


def resolve_required_permission(path: str, method: str) -> Optional[str]:
    method = str(method or "").upper()
    for candidate in _candidate_paths(path):
        for map_method, prefix, permission in ROUTE_PERMISSION_MAP:
            if method == map_method and candidate.startswith(prefix):
                return permission
    return None


def effective_permissions_for_role(role_code: str) -> List[str]:
    canonical_code = get_canonical_role_code(role_code)
    return list(ROLE_PERMISSION_MATRIX.get(canonical_code, []))


def can_with_wildcard(granted: Iterable[str], required: str) -> bool:
    granted_set = {str(p) for p in granted}
    return "*" in granted_set or required in granted_set


def normalize_permission_code(permission: str) -> str:
    return str(permission or "").strip().replace(":", ".")


@lru_cache(maxsize=1)
def get_permission_catalog() -> List[Dict[str, object]]:
    sources_by_permission: Dict[str, Set[str]] = {}
    page_meta_by_permission: Dict[str, Dict[str, str]] = {}

    for _, _, permission in ROUTE_PERMISSION_MAP:
        normalized = normalize_permission_code(permission)
        if not normalized:
            continue
        sources_by_permission.setdefault(normalized, set()).add("route")

    for permissions in ROLE_PERMISSION_MATRIX.values():
        for permission in permissions or []:
            normalized = normalize_permission_code(permission)
            if not normalized:
                continue
            sources_by_permission.setdefault(normalized, set()).add("matrix")

    for page in FRONTEND_PAGE_PERMISSION_CATALOG:
        normalized = normalize_permission_code(page.get("permission", ""))
        if not normalized:
            continue
        sources_by_permission.setdefault(normalized, set()).add("page")
        page_meta_by_permission[normalized] = page

    catalog: List[Dict[str, object]] = []
    for permission in sorted(sources_by_permission.keys()):
        if permission == "*":
            module_key = "*"
            action_key = "*"
        else:
            module_key, _, action_key = permission.partition(".")
        sources = sorted(sources_by_permission[permission])
        row = {
            "permission": permission,
            "module": module_key,
            "action": action_key or "",
            "source": ",".join(sources),
            "sources": sources,
            "assignable": permission != "*",
        }
        page_meta = page_meta_by_permission.get(permission)
        if page_meta:
            row.update(
                {
                    "label": page_meta.get("label") or permission,
                    "route": page_meta.get("route") or "",
                }
            )
        catalog.append(row)
    return catalog


def known_permissions(assignable_only: bool = False) -> Set[str]:
    values = set()
    for row in get_permission_catalog():
        permission = str(row.get("permission") or "")
        if not permission:
            continue
        if assignable_only and not bool(row.get("assignable")):
            continue
        values.add(permission)
    return values


def is_known_permission(permission: str) -> bool:
    normalized = normalize_permission_code(permission)
    return normalized in known_permissions(assignable_only=False)


def is_assignable_permission(permission: str) -> bool:
    normalized = normalize_permission_code(permission)
    return normalized in known_permissions(assignable_only=True)
