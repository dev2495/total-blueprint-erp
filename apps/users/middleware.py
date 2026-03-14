import logging
from django.conf import settings
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
        if request.user.is_authenticated and (request.user.is_superuser or request.user.is_owner or (request.user.role and request.user.role.code in ['ADMIN', 'SUPER_ADMIN'])):
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

        response = self.get_response(request)
        return response

    @staticmethod
    def _audit_override(request, override_role: str, allowed: bool):
        try:
            from apps.users.models import PermissionAuditLog

            user = getattr(request, "user", None)
            PermissionAuditLog.objects.create(
                user=user if getattr(user, "is_authenticated", False) else None,
                action='ROLE_OVERRIDE',
                method=str(getattr(request, "method", "")),
                path=str(getattr(request, "path", "")),
                effective_role=override_role,
                details={"allowed": bool(allowed)},
            )
        except Exception:
            logger.warning("Failed to persist role override audit", exc_info=True)
