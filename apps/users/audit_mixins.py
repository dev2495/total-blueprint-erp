from __future__ import annotations

from apps.users.models import PermissionAuditLog


class MasterDataAuditMixin:
    audit_area = "MASTER"

    def _audit_master_change(self, operation: str, instance) -> None:
        request = getattr(self, "request", None)
        user = getattr(request, "user", None)
        if user is not None and not getattr(user, "is_authenticated", False):
            user = None
        label = str(getattr(instance, "name", None) or getattr(instance, "code", None) or getattr(instance, "id", ""))
        PermissionAuditLog.objects.create(
            user=user,
            action="MASTER_DATA_CHANGED",
            method=str(getattr(request, "method", "") or operation),
            path=str(getattr(request, "path", "") or ""),
            effective_role=str(getattr(user, "effective_role_code", getattr(getattr(user, "role", None), "code", "")) or ""),
            details={
                "operation": operation,
                "area": self.audit_area,
                "model": instance.__class__.__name__,
                "object_id": str(getattr(instance, "id", "")),
                "label": label,
            },
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        self._audit_master_change("CREATE", instance)

    def perform_update(self, serializer):
        instance = serializer.save()
        self._audit_master_change("UPDATE", instance)

    def perform_destroy(self, instance):
        self._audit_master_change("DELETE", instance)
        instance.delete()
