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
        "mrp.view",
        "mrp.manage",
        "dashboard.view",
        "analytics.view",
        "sales.view",
        "notifications.view",
        "factory.view",
    ],
    "WORK_CENTER_MANAGER": [
        "users.self_manage",
        "production.view",
        "production.manage",
        "inventory.view",
        "dashboard.view",
        "analytics.view",
        "notifications.view",
        "factory.view",
    ],
    "OPERATOR": [
        "users.self_manage",
        "production.view",
        "production.manage",
        "dashboard.view",
        "notifications.view",
        "factory.view",
    ],
    "STORE": [
        "users.self_manage",
        "inventory.view",
        "inventory.manage",
        "mrp.view",
        "dashboard.view",
        "notifications.view",
        "sales.view",
    ],
    "DISPATCH": [
        "users.self_manage",
        "inventory.view",
        "inventory.manage",
        "sales.view",
        "dashboard.view",
        "notifications.view",
    ],
    "PLANT_MANAGER": [
        "users.self_manage",
        "dashboard.view",
        "analytics.view",
        "production.view",
        "inventory.view",
        "factory.view",
        "sales.view",
        "notifications.view",
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

    catalog: List[Dict[str, object]] = []
    for permission in sorted(sources_by_permission.keys()):
        if permission == "*":
            module_key = "*"
            action_key = "*"
        else:
            module_key, _, action_key = permission.partition(".")
        sources = sorted(sources_by_permission[permission])
        catalog.append(
            {
                "permission": permission,
                "module": module_key,
                "action": action_key or "",
                "source": ",".join(sources),
                "sources": sources,
                "assignable": permission != "*",
            }
        )
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
