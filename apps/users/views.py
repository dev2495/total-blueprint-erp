from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator, validate_email
from django.db.models import Q
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken, TokenError

from .models import (
    Notification,
    NotificationDeliveryAttempt,
    NotificationRule,
    PermissionAuditLog,
    Role,
    RoleVisibilitySignoff,
    User,
    UserProfileChangeRequest,
)
from .permission_registry import (
    get_permission_catalog,
    is_known_permission,
    normalize_permission_code,
)
from .permission_service import PermissionService
from .role_catalog import canonicalize_role_matrix, canonicalize_role_rows, get_canonical_role_code
from .serializers import (
    MyTokenObtainPairSerializer,
    RoleSerializer,
    UserProfileChangeRequestSerializer,
    UserSerializer,
)
from .csrf import enforce_request_csrf
from .services.notification_service import NotificationService


def _is_admin_actor(user) -> bool:
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(user.is_authenticated and (user.is_superuser or user.is_owner or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"}))


def _normalize_profile_changes(payload) -> dict:
    allowed_fields = {"first_name", "last_name", "email", "phone_number", "avatar_url"}
    validator_url = URLValidator()
    changes = {}
    for field, raw_value in (payload or {}).items():
        if field not in allowed_fields:
            continue
        value = str(raw_value or "").strip()
        if field in {"first_name", "last_name"}:
            changes[field] = value[:150]
            continue
        if field == "email":
            if not value:
                raise ValueError("email cannot be empty")
            try:
                validate_email(value)
            except DjangoValidationError as exc:
                raise ValueError("email is invalid") from exc
            changes[field] = value.lower()
            continue
        if field == "phone_number":
            changes[field] = value[:30]
            continue
        if field == "avatar_url":
            if value:
                try:
                    validator_url(value)
                except DjangoValidationError as exc:
                    raise ValueError("avatar_url is invalid") from exc
            changes[field] = value
    return changes


def _jwt_lifetime_seconds(key: str, fallback_seconds: int) -> int:
    raw = settings.SIMPLE_JWT.get(key, timedelta(seconds=fallback_seconds))
    if isinstance(raw, timedelta):
        return int(raw.total_seconds())
    return fallback_seconds


def _audit_role_code(user) -> str:
    return str(getattr(user, "effective_role_code", getattr(getattr(user, "role", None), "code", "")) or "").upper()


def _set_auth_cookies(response: Response, refresh_token: str):
    refresh_obj = RefreshToken(refresh_token)
    access_token = str(refresh_obj.access_token)
    access_seconds = _jwt_lifetime_seconds("ACCESS_TOKEN_LIFETIME", 900)
    refresh_seconds = _jwt_lifetime_seconds("REFRESH_TOKEN_LIFETIME", 86400)

    cookie_common = {
        "httponly": bool(getattr(settings, "JWT_COOKIE_HTTPONLY", True)),
        "secure": bool(getattr(settings, "JWT_COOKIE_SECURE", False)),
        "samesite": str(getattr(settings, "JWT_COOKIE_SAMESITE", "Lax")),
    }
    domain = getattr(settings, "JWT_COOKIE_DOMAIN", None)
    if domain:
        cookie_common["domain"] = domain

    response.set_cookie(
        key=str(getattr(settings, "JWT_ACCESS_COOKIE_NAME", "access")),
        value=access_token,
        max_age=access_seconds,
        path=str(getattr(settings, "JWT_ACCESS_COOKIE_PATH", "/")),
        **cookie_common,
    )
    response.set_cookie(
        key=str(getattr(settings, "JWT_REFRESH_COOKIE_NAME", "refresh")),
        value=str(refresh_obj),
        max_age=refresh_seconds,
        path=str(getattr(settings, "JWT_REFRESH_COOKIE_PATH", "/api/users/token/refresh/")),
        **cookie_common,
    )


def _clear_auth_cookies(response: Response):
    access_kwargs = {
        "path": str(getattr(settings, "JWT_ACCESS_COOKIE_PATH", "/")),
        "samesite": str(getattr(settings, "JWT_COOKIE_SAMESITE", "Lax")),
    }
    refresh_kwargs = {
        "path": str(getattr(settings, "JWT_REFRESH_COOKIE_PATH", "/api/users/token/refresh/")),
        "samesite": str(getattr(settings, "JWT_COOKIE_SAMESITE", "Lax")),
    }
    domain = getattr(settings, "JWT_COOKIE_DOMAIN", None)
    if domain:
        access_kwargs["domain"] = domain
        refresh_kwargs["domain"] = domain

    response.delete_cookie(str(getattr(settings, "JWT_ACCESS_COOKIE_NAME", "access")), **access_kwargs)
    response.delete_cookie(str(getattr(settings, "JWT_REFRESH_COOKIE_NAME", "refresh")), **refresh_kwargs)


def _extract_refresh_token(request) -> str:
    body_refresh = str((request.data or {}).get("refresh") or "").strip()
    if body_refresh:
        return body_refresh
    cookie_name = str(getattr(settings, "JWT_REFRESH_COOKIE_NAME", "refresh"))
    return str(request.COOKIES.get(cookie_name) or "").strip()


class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request, *args, **kwargs):
        enforce_request_csrf(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        refresh_token = str(serializer.validated_data.get("refresh") or "")
        user = serializer.user
        PermissionAuditLog.objects.create(
            user=user,
            action="USER_LOGIN",
            method="POST",
            path="/api/users/login/",
            effective_role=_audit_role_code(user),
            details={"status": "authenticated"},
        )
        payload = {
            "status": "authenticated",
            "user": UserSerializer(user, context={"request": request}).data,
        }
        response = Response(payload, status=status.HTTP_200_OK)
        get_token(request)
        _set_auth_cookies(response, refresh_token)
        return response


class CookieTokenRefreshView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        enforce_request_csrf(request)
        refresh = _extract_refresh_token(request)
        if not refresh:
            return Response({"detail": "refresh token is required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TokenRefreshSerializer(data={"refresh": refresh})
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            return Response({"detail": "Invalid refresh token"}, status=status.HTTP_401_UNAUTHORIZED)

        rotated_refresh = str(serializer.validated_data.get("refresh") or refresh)
        response = Response({"status": "refreshed"}, status=status.HTTP_200_OK)
        get_token(request)
        _set_auth_cookies(response, rotated_refresh)
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        enforce_request_csrf(request)
        refresh = _extract_refresh_token(request)
        blacklisted = False
        try:
            if refresh:
                token = RefreshToken(refresh)
                token.blacklist()
                blacklisted = True
        except TokenError:
            blacklisted = False

        PermissionAuditLog.objects.create(
            user=request.user if getattr(request.user, "is_authenticated", False) else None,
            action="USER_LOGOUT",
            method="POST",
            path="/api/users/logout/",
            effective_role=_audit_role_code(request.user) if getattr(request.user, "is_authenticated", False) else "",
            details={"status": "blacklisted" if blacklisted else "cookie_cleared"},
        )
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_auth_cookies(response)
        return response


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfCookieView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get(self, request):
        return Response({"status": "ok", "csrfToken": get_token(request)})


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current_password = str(request.data.get("current_password") or "")
        new_password = str(request.data.get("new_password") or "")
        if not current_password or not new_password:
            return Response(
                {"detail": "current_password and new_password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if not user.check_password(current_password):
            return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({"detail": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=["password"])
        PermissionAuditLog.objects.create(
            user=user,
            action="PASSWORD_CHANGED",
            method="POST",
            path="/api/users/change-password/",
            details={"status": "updated"},
        )
        return Response({"status": "password_updated", "require_relogin": True})


class ProfileChangeRequestViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        qs = UserProfileChangeRequest.objects.select_related("requested_by", "target_user", "reviewed_by")
        if not _is_admin_actor(request.user):
            qs = qs.filter(requested_by=request.user)
        else:
            status_filter = str(request.query_params.get("status") or "").upper().strip()
            user_id = str(request.query_params.get("user_id") or "").strip()
            if status_filter:
                qs = qs.filter(status=status_filter)
            if user_id:
                qs = qs.filter(target_user_id=user_id)

        serializer = UserProfileChangeRequestSerializer(qs.order_by("-created_at"), many=True)
        return Response(serializer.data)

    def create(self, request):
        payload = request.data.get("requested_changes")
        if payload is None:
            payload = request.data
        try:
            changes = _normalize_profile_changes(payload)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not changes:
            return Response({"detail": "No valid profile fields provided"}, status=status.HTTP_400_BAD_REQUEST)

        row = UserProfileChangeRequest.objects.create(
            requested_by=request.user,
            target_user=request.user,
            requested_changes=changes,
            status="PENDING",
        )
        PermissionAuditLog.objects.create(
            user=request.user,
            action="PROFILE_CHANGE_REQUESTED",
            method="POST",
            path="/api/users/profile-change-requests/",
            details={"request_id": str(row.id), "fields": sorted(changes.keys())},
        )
        return Response(UserProfileChangeRequestSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"], url_path="review")
    def review(self, request, pk=None):
        row = UserProfileChangeRequest.objects.select_related("target_user", "requested_by").filter(id=pk).first()
        if not row:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        if row.requested_by_id == request.user.id:
            return Response({"detail": "Self-approval is not allowed"}, status=status.HTTP_400_BAD_REQUEST)
        if row.status != "PENDING":
            return Response({"detail": "Only pending requests can be reviewed"}, status=status.HTTP_400_BAD_REQUEST)

        decision = str(request.data.get("decision") or "").upper().strip()
        notes = str(request.data.get("notes") or "").strip()
        if decision not in {"APPROVE", "REJECT"}:
            return Response({"detail": "decision must be APPROVE or REJECT"}, status=status.HTTP_400_BAD_REQUEST)

        if decision == "APPROVE":
            target = row.target_user
            requested_changes = dict(row.requested_changes or {})
            try:
                normalized_changes = _normalize_profile_changes(requested_changes)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            for attr, value in normalized_changes.items():
                setattr(target, attr, value)
            target.save(update_fields=list(normalized_changes.keys()))
            row.status = "APPROVED"
        else:
            row.status = "REJECTED"

        row.review_notes = notes
        row.reviewed_by = request.user
        row.reviewed_at = timezone.now()
        row.save(update_fields=["status", "review_notes", "reviewed_by", "reviewed_at", "updated_at"])

        PermissionAuditLog.objects.create(
            user=request.user,
            action="PROFILE_CHANGE_REVIEWED",
            method="POST",
            path=f"/api/users/profile-change-requests/{pk}/review/",
            details={"decision": decision, "request_id": str(row.id)},
        )
        return Response(UserProfileChangeRequestSerializer(row).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        row = UserProfileChangeRequest.objects.filter(id=pk).first()
        if not row:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        if row.requested_by_id != request.user.id:
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        if row.status != "PENDING":
            return Response({"detail": "Only pending requests can be cancelled"}, status=status.HTTP_400_BAD_REQUEST)

        row.status = "CANCELLED"
        row.reviewed_by = request.user
        row.reviewed_at = timezone.now()
        row.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
        return Response(UserProfileChangeRequestSerializer(row).data)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request, *args, **kwargs):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        rows = canonicalize_role_rows(self.get_queryset())
        return Response(rows)

    def create(self, request, *args, **kwargs):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        response = super().create(request, *args, **kwargs)
        PermissionAuditLog.objects.create(
            user=request.user,
            action='ROLE_CHANGED',
            method='POST',
            path='/api/users/roles/',
            details={'created_role': response.data.get('code')},
        )
        return response

    def update(self, request, *args, **kwargs):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        response = super().update(request, *args, **kwargs)
        PermissionAuditLog.objects.create(
            user=request.user,
            action='ROLE_CHANGED',
            method=str(request.method).upper(),
            path=f"/api/users/roles/{kwargs.get('pk')}/",
            details={'updated_role': response.data.get('code')},
        )
        return response

    @action(detail=False, methods=['get'], url_path='matrix/export')
    def export_matrix(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return Response(canonicalize_role_matrix(PermissionService.get_role_matrix()))

    @action(detail=False, methods=['get'], url_path='permissions/catalog')
    def permissions_catalog(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return Response(get_permission_catalog())

    @action(detail=False, methods=['post'], url_path='matrix/sync-defaults')
    def sync_matrix_defaults(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        updated = PermissionService.sync_default_permissions_from_matrix()
        PermissionAuditLog.objects.create(
            user=request.user,
            action='ROLE_CHANGED',
            method='POST',
            path='/api/users/roles/matrix/sync-defaults/',
            details={'updated_roles': updated},
        )
        return Response({"updated_roles": updated})

    @action(detail=False, methods=['post'], url_path='matrix/import')
    def import_matrix(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        matrix = request.data.get("matrix") or {}
        if not isinstance(matrix, dict):
            return Response({"detail": "matrix must be an object"}, status=status.HTTP_400_BAD_REQUEST)

        normalized_matrix = {}
        invalid_permissions = {}
        for role_code, permissions in matrix.items():
            normalized = get_canonical_role_code(role_code)
            if not normalized:
                continue
            normalized_permissions = []
            unknown = []
            for permission in permissions or []:
                value = normalize_permission_code(permission)
                if not value:
                    continue
                if not is_known_permission(value):
                    unknown.append(value)
                    continue
                normalized_permissions.append(value)
            if unknown:
                invalid_permissions[normalized] = sorted(set(unknown))
                continue
            normalized_matrix[normalized] = list(dict.fromkeys(normalized_permissions))

        if invalid_permissions:
            return Response(
                {
                    "detail": "matrix contains unknown permissions",
                    "invalid_permissions": invalid_permissions,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated_roles = []
        for role_code, permissions in normalized_matrix.items():
            role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": role_code.title()})
            role.default_permissions = permissions
            role.save(update_fields=["default_permissions"])
            updated_roles.append(role_code)

        PermissionAuditLog.objects.create(
            user=request.user,
            action='ROLE_CHANGED',
            method='POST',
            path='/api/users/roles/matrix/import/',
            details={'updated_roles': updated_roles},
        )
        return Response({"updated_roles": updated_roles})

    @action(detail=False, methods=['get'], url_path='visibility/revalidate')
    def revalidate_visibility(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return Response(PermissionService.validate_role_visibility_matrix())

    @action(detail=False, methods=['post'], url_path='visibility/bootstrap-signoffs')
    def bootstrap_visibility_signoffs(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        result = PermissionService.bootstrap_visibility_signoffs()
        PermissionAuditLog.objects.create(
            user=request.user,
            action='SIGNOFF_UPDATED',
            method='POST',
            path='/api/users/roles/visibility/bootstrap-signoffs/',
            details=result,
        )
        return Response(result)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = User.objects.all().order_by("username")
        email_missing = str(self.request.query_params.get("email_missing") or "").lower().strip()
        if email_missing in {"1", "true", "yes"}:
            qs = qs.filter(Q(email__isnull=True) | Q(email__exact=""))
        elif email_missing in {"0", "false", "no"}:
            qs = qs.exclude(Q(email__isnull=True) | Q(email__exact=""))
        return qs

    @action(detail=False, methods=['get'])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='assign-work-centers')
    def assign_work_centers(self, request, pk=None):
        if not _is_admin_actor(request.user):
            return Response({"error": "Permission denied"}, status=403)

        user = self.get_object()
        wc_ids = request.data.get('work_center_ids', [])
        try:
            result = PermissionService.assign_work_centers(user, wc_ids)
        except DjangoValidationError as exc:
            PermissionAuditLog.objects.create(
                user=request.user,
                action="ROLE_CHANGED",
                method="POST",
                path=f"/api/users/users/{user.id}/assign-work-centers/",
                details={
                    "target_user_id": str(user.id),
                    "status": "rejected",
                    "errors": exc.message_dict if hasattr(exc, "message_dict") else exc.messages,
                },
            )
            return Response(
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        PermissionAuditLog.objects.create(
            user=request.user,
            action="ROLE_CHANGED",
            method="POST",
            path=f"/api/users/users/{user.id}/assign-work-centers/",
            details={
                "target_user_id": str(user.id),
                "status": "assigned",
                "work_center_count": result.get("count", 0),
            },
        )
        return Response({"status": "assigned", **result})

    @action(detail=True, methods=['post'], url_path='assign-machines')
    def assign_machines(self, request, pk=None):
        if not _is_admin_actor(request.user):
            return Response({"error": "Permission denied"}, status=403)

        user = self.get_object()
        machine_ids = request.data.get('machine_ids', [])
        try:
            result = PermissionService.assign_machines(user, machine_ids)
        except DjangoValidationError as exc:
            PermissionAuditLog.objects.create(
                user=request.user,
                action="ROLE_CHANGED",
                method="POST",
                path=f"/api/users/users/{user.id}/assign-machines/",
                details={
                    "target_user_id": str(user.id),
                    "status": "rejected",
                    "errors": exc.message_dict if hasattr(exc, "message_dict") else exc.messages,
                },
            )
            return Response(
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        PermissionAuditLog.objects.create(
            user=request.user,
            action="ROLE_CHANGED",
            method="POST",
            path=f"/api/users/users/{user.id}/assign-machines/",
            details={
                "target_user_id": str(user.id),
                "status": "assigned",
                "machine_count": result.get("count", 0),
            },
        )
        return Response({"status": "assigned", **result})

    @action(detail=False, methods=['get'], url_path='entitlements/validate')
    def validate_entitlements(self, request):
        result = PermissionService.validate_entitlements(request.user)
        return Response(result)

    @action(detail=True, methods=['get'], url_path='entitlements/validate')
    def validate_entitlements_for_user(self, request, pk=None):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        user = self.get_object()
        return Response(PermissionService.validate_entitlements(user))


class NotificationViewSet(viewsets.ViewSet):
    """API endpoints for notifications and notification routing rules."""

    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='list')
    def list_notifications(self, request):
        unread_only = request.query_params.get('unread_only', 'false').lower() == 'true'
        limit = int(request.query_params.get('limit', 50))

        notifications = NotificationService.get_notifications_for_user(
            request.user,
            include_unread_only=unread_only,
            limit=limit,
        )

        data = []
        for n in notifications:
            attempts = NotificationDeliveryAttempt.objects.filter(notification=n).order_by('-created_at')[:10]
            data.append(
                {
                    'id': str(n.id),
                    'event_key': n.event_key,
                    'type': n.type,
                    'title': n.title,
                    'message': n.message,
                    'priority': n.priority,
                    'channels': n.channels,
                    'delivery_state': n.delivery_state,
                    'is_read': n.is_read,
                    'created_at': n.created_at.isoformat(),
                    'related_object_type': n.related_object_type,
                    'related_object_id': str(n.related_object_id) if n.related_object_id else None,
                    'delivery_attempts': [
                        {
                            'id': str(a.id),
                            'channel': a.channel,
                            'status': a.status,
                            'attempt_no': a.attempt_no,
                            'recipient': a.recipient,
                            'provider_message_id': a.provider_message_id,
                            'error_text': a.error_text,
                            'created_at': a.created_at.isoformat(),
                            'delivered_at': a.delivered_at.isoformat() if a.delivered_at else None,
                        }
                        for a in attempts
                    ],
                }
            )

        return Response(data)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        count = NotificationService.get_unread_count(request.user)
        return Response({'count': count})

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        success = NotificationService.mark_as_read(pk, request.user)
        if success:
            return Response({'status': 'marked_read'})
        return Response({'error': 'Not found or no access'}, status=404)

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        role_code = get_canonical_role_code(getattr(getattr(request.user, "role", None), "code", ""))
        Notification.objects.filter(
            Q(user=request.user) | Q(target_role=role_code),
            is_read=False,
        ).update(is_read=True, read_at=timezone.now())
        return Response({'status': 'all_marked_read'})

    @action(detail=False, methods=['get'], url_path='rules')
    def list_rules(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        rules = NotificationRule.objects.order_by('event_key')
        data = [
            {
                'id': str(rule.id),
                'event_key': rule.event_key,
                'target_roles': rule.target_roles,
                'channels': rule.channels,
                'priority': rule.priority,
                'active': rule.active,
                'escalation_minutes': rule.escalation_minutes,
                'email_subject_template': rule.email_subject_template,
                'email_body_template': rule.email_body_template,
                'updated_at': rule.updated_at.isoformat(),
            }
            for rule in rules
        ]
        return Response(data)

    @action(detail=False, methods=['post'], url_path='rules/upsert')
    def upsert_rule(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        event_key = str(request.data.get('event_key') or '').strip()
        if not event_key:
            return Response({"detail": "event_key is required"}, status=status.HTTP_400_BAD_REQUEST)

        defaults = {
            'target_roles': request.data.get('target_roles') or [],
            'channels': request.data.get('channels') or ['IN_APP'],
            'priority': request.data.get('priority') or 'NORMAL',
            'active': bool(request.data.get('active', True)),
            'escalation_minutes': int(request.data.get('escalation_minutes') or 0),
            'email_subject_template': request.data.get('email_subject_template') or '',
            'email_body_template': request.data.get('email_body_template') or '',
        }
        rule, _ = NotificationRule.objects.update_or_create(event_key=event_key, defaults=defaults)

        return Response(
            {
                'id': str(rule.id),
                'event_key': rule.event_key,
                'target_roles': rule.target_roles,
                'channels': rule.channels,
                'priority': rule.priority,
                'active': rule.active,
            }
        )

    @action(detail=False, methods=['get'], url_path='role-signoffs')
    def list_role_signoffs(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        rows = RoleVisibilitySignoff.objects.order_by('role_code', 'module_key', 'action_key')
        return Response(
            [
                {
                    'id': str(row.id),
                    'role_code': row.role_code,
                    'module_key': row.module_key,
                    'action_key': row.action_key,
                    'approved': row.approved,
                    'approved_at': row.approved_at.isoformat() if row.approved_at else None,
                    'approved_by': str(row.approved_by_id) if row.approved_by_id else None,
                    'notes': row.notes,
                }
                for row in rows
            ]
        )

    @action(detail=False, methods=['post'], url_path='role-signoffs/upsert')
    def upsert_role_signoff(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        role_code = str(request.data.get('role_code') or '').upper()
        module_key = str(request.data.get('module_key') or '')
        action_key = str(request.data.get('action_key') or '')
        approved = bool(request.data.get('approved', False))
        if not (role_code and module_key and action_key):
            return Response({"detail": "role_code, module_key and action_key are required"}, status=400)

        row, _ = RoleVisibilitySignoff.objects.get_or_create(
            role_code=role_code,
            module_key=module_key,
            action_key=action_key,
        )
        row.approved = approved
        row.approved_at = timezone.now() if approved else None
        row.approved_by = request.user if approved else None
        row.notes = str(request.data.get('notes') or '')
        row.save()

        PermissionAuditLog.objects.create(
            user=request.user,
            action='SIGNOFF_UPDATED',
            method='POST',
            path='/api/users/notifications/role-signoffs/upsert/',
            details={
                'role_code': role_code,
                'module_key': module_key,
                'action_key': action_key,
                'approved': approved,
            },
        )

        return Response({"status": "updated", "id": str(row.id)})

    @action(detail=False, methods=['get'], url_path='permission-audit')
    def permission_audit(self, request):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        rows = PermissionAuditLog.objects.select_related('user').order_by('-created_at')[:200]
        return Response(
            [
                {
                    'id': str(r.id),
                    'action': r.action,
                    'method': r.method,
                    'path': r.path,
                    'required_permission': r.required_permission,
                    'effective_role': r.effective_role,
                    'user': r.user.username if r.user else None,
                    'details': r.details,
                    'created_at': r.created_at.isoformat(),
                }
                for r in rows
            ]
        )
