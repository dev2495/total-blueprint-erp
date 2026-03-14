from django.conf import settings
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.users.csrf import enforce_request_csrf


class CookieJWTAuthentication(JWTAuthentication):
    """
    JWT authentication with cookie-first support.
    - Accepts bearer token headers (backward compatible).
    - Accepts HttpOnly access token cookie for browser clients.
    - Enforces CSRF validation for unsafe cookie-authenticated requests.
    """

    def authenticate(self, request):
        # Header path first to preserve backward compatibility for service clients.
        header = self.get_header(request)
        if header is not None:
            raw_token = self.get_raw_token(header)
            if raw_token is not None:
                validated_token = self.get_validated_token(raw_token)
                return self.get_user(validated_token), validated_token

        cookie_name = str(getattr(settings, "JWT_ACCESS_COOKIE_NAME", "access"))
        raw_token = str(request.COOKIES.get(cookie_name) or "").strip()
        if not raw_token:
            return None

        validated_token = self.get_validated_token(raw_token)
        if str(getattr(request, "method", "GET")).upper() not in SAFE_METHODS:
            enforce_request_csrf(request)
        return self.get_user(validated_token), validated_token
