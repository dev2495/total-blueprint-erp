import logging
from django.http import JsonResponse
from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

logger = logging.getLogger(__name__)
UserModel = get_user_model()

class RoleOverrideMiddleware:
    """
    Middleware to allow Admin and Owner users to 'emulate' other roles.
    Expects X-Role-Override header.
    JWT-aware: Decodes token early to identify user before rest_framework.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 1. Early User Identification for API Requests (JWT-aware)
        if not request.user.is_authenticated:
            token_candidates = []
            auth_header = request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token_candidates.append(auth_header.split(' ')[1])

            cookie_name = str(getattr(settings, "JWT_ACCESS_COOKIE_NAME", "access"))
            cookie_token = request.COOKIES.get(cookie_name)
            if cookie_token:
                token_candidates.append(cookie_token)

            for token_str in token_candidates:
                try:
                    token = AccessToken(token_str)
                    user_id = token.get('user_id')
                    if user_id:
                        request.user = UserModel.objects.get(id=user_id)
                        break
                except Exception:
                    continue

        # 2. Check for Role Override
        if request.user.is_authenticated and (request.user.is_superuser or request.user.is_owner or (request.user.role and request.user.role.code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'])):
            override_role = request.headers.get('X-Role-Override') or request.META.get('HTTP_X_ROLE_OVERRIDE')
            allow_override = bool(getattr(settings, 'ALLOW_ROLE_OVERRIDE', False))

            if override_role and allow_override:
                request.user.effective_role_code = str(override_role).upper()
                logger.info("Role Override for %s: %s", request.user.username, request.user.effective_role_code)
                self._audit_override(request, request.user.effective_role_code, allowed=True)
            elif override_role and not allow_override:
                request.user.effective_role_code = request.user.role.code if request.user.role else 'GUEST'
                logger.warning("Blocked role override for %s in strict mode", request.user.username)
                self._audit_override(request, str(override_role).upper(), allowed=False)
            else:
                request.user.effective_role_code = request.user.role.code if request.user.role else 'GUEST'
        else:
            if request.user.is_authenticated:
                request.user.effective_role_code = request.user.role.code if request.user.role else 'GUEST'
            else:
                request.user.effective_role_code = 'GUEST'

        # This ceiling also covers ViewSets that intentionally replace the
        # default DRF RBAC class with IsAuthenticated. It is always active for
        # WATCHMAN, including development and bearer/cookie authentication.
        if request.user.is_authenticated:
            from apps.users.role_catalog import get_canonical_role_code
            actual_role = get_canonical_role_code(getattr(getattr(request.user, "role", None), "code", ""))
            effective_role = get_canonical_role_code(getattr(request.user, "effective_role_code", ""))
            if "WATCHMAN" in {actual_role, effective_role} and not self._watchman_path_allowed(request):
                from apps.users.permissions import RoleBasedAccessPermission
                RoleBasedAccessPermission._log_denied(request.user, request.method, request.path, "WATCHMAN_SCOPE")
                return JsonResponse({"detail": "Watchman access is limited to the gate terminal and your own account."}, status=403)

        response = self.get_response(request)
        return response

    @staticmethod
    def _watchman_path_allowed(request):
        path = str(request.path or "").rstrip("/")
        method = str(request.method or "GET").upper()
        if path == "/admin" or path.startswith("/admin/"):
            return False
        if not path.startswith("/api/"):
            return True
        if path.startswith("/api/gate/") or path == "/api/gate":
            if path == "/api/gate/inward-bills" or path.startswith("/api/gate/inward-bills/"):
                import re
                from uuid import UUID

                if method == "POST":
                    return path == "/api/gate/inward-bills"
                if method in {"GET", "HEAD", "OPTIONS"}:
                    if path == "/api/gate/inward-bills":
                        return True
                    match = re.fullmatch(r"/api/gate/inward-bills/([^/]+)(?:/pages/([^/]+))?", path)
                    if match:
                        try:
                            for value in match.groups():
                                if value:
                                    UUID(value)
                            return True
                        except ValueError:
                            pass
                return False
            if method not in {"GET", "HEAD", "OPTIONS"} and (path == "/api/gate/visitors" or path.startswith("/api/gate/visitors/")):
                # QR submission records entry. Watchmen may only confirm exit,
                # including when an older pending registration still exists.
                segments = path.strip("/").split("/")
                return method == "POST" and len(segments) == 5 and segments[-1] == "check-out"
            # Gate views apply action and plant checks independently.
            return True
        from apps.users.permission_registry import is_public_endpoint
        if is_public_endpoint(path):
            return True
        allowed = {
            "GET": {"/api/users/me", "/api/auth/me", "/api/users/users/me", "/api/auth/users/me", "/api/users/profile-change-requests", "/api/auth/profile-change-requests", "/api/users/users/entitlements/validate", "/api/auth/users/entitlements/validate"},
            "POST": {"/api/users/logout", "/api/auth/logout", "/api/users/change-password", "/api/auth/change-password", "/api/users/profile-change-requests", "/api/auth/profile-change-requests"},
        }
        return path in allowed.get(method, set()) or method == "OPTIONS" and path in set().union(*allowed.values())

    @staticmethod
    def _audit_override(request, override_role: str, allowed: bool):
        try:
            from apps.users.models import PermissionAuditLog

            user = getattr(request, "user", None)
            method = str(getattr(request, "method", ""))
            path = str(getattr(request, "path", ""))
            user_id = getattr(user, "id", "anonymous")
            role_code = str(override_role or "").upper()
            cache_key = f"role_override_audit:{user_id}:{method}:{path}:{role_code}:{int(bool(allowed))}"
            if method.upper() in {"GET", "HEAD", "OPTIONS"} and cache.get(cache_key):
                return
            if method.upper() in {"GET", "HEAD", "OPTIONS"}:
                cache.set(cache_key, True, 10 * 60)
            PermissionAuditLog.objects.create(
                user=user if getattr(user, "is_authenticated", False) else None,
                action='ROLE_OVERRIDE',
                method=method,
                path=path,
                effective_role=role_code,
                details={
                    "allowed": bool(allowed),
                    "override_role": role_code,
                    "decision": "APPLIED" if allowed else "BLOCKED",
                    "summary": f"Role preview {'applied' if allowed else 'blocked'} for {role_code} on {method} {path}",
                },
            )
        except Exception:
            logger.warning("Failed to persist role override audit", exc_info=True)
