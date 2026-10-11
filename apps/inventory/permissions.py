"""Write authority for inventory endpoints.

Reads stay open to every signed-in account: sales, planning, the work-center
terminals and engineering all look up stock, rolls and locations. Anything
that changes stock, locations or stock evidence needs an explicit capability,
declared per action on the view and denied by default.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService

STOCK_MANAGE = ("inventory.manage",)
# Goods receipts: the store, or purchase staff who hold receipt authority.
RECEIPT_POSTING = ("inventory.manage", "procurement.manage")
# Material moved for production: the store or the shop floor.
FLOOR_MOVEMENT = ("inventory.manage", "production.manage")
LOCATION_MASTER = ("factory.manage",)


def has_any_permission(user, codes) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
        return False
    if PermissionService.is_watchman(user):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
        return True
    granted = set(PermissionService.get_user_permissions(user))
    return any(can_with_wildcard(granted, code) for code in codes)


class InventoryActionPermission(BasePermission):
    """Reads: any signed-in account. Writes: ``view.write_permissions``.

    ``write_permissions`` maps a ViewSet action (or, for a plain APIView, the
    lower-case HTTP method) to the capabilities that may perform it; ``"*"``
    is the fallback. An unmapped write is refused.
    """

    message = "Your role cannot change inventory. Ask the store or an administrator."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        if request.method in SAFE_METHODS:
            return True
        mapping = getattr(view, "write_permissions", None) or {}
        action = getattr(view, "action", None) or str(request.method or "").lower()
        codes = mapping.get(action, mapping.get("*"))
        if codes and has_any_permission(user, codes):
            return True
        from apps.users.permissions import RoleBasedAccessPermission

        RoleBasedAccessPermission._log_denied(
            user,
            str(request.method or "").upper(),
            str(getattr(request, "path", "") or ""),
            required_permission="|".join(codes or ("UNMAPPED",)),
            request=request,
        )
        return False
