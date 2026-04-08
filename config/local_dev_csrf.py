import ipaddress
from urllib.parse import urlparse

from django.middleware.csrf import CsrfViewMiddleware


def _is_local_dev_host(host: str | None) -> bool:
    token = str(host or "").strip().lower()
    if not token:
        return False
    token = token.split(":", 1)[0].strip("[]")
    if token in {"localhost", "127.0.0.1", "::1"}:
        return True
    if token.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(token)
    except ValueError:
        return False
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local)


class LocalDevCsrfViewMiddleware(CsrfViewMiddleware):
    """
    Local-only CSRF origin relaxation for same-network QA on phones/tablets.

    Django still enforces standard CSRF tokens. This only broadens origin
    matching for private-LAN hosts during local development, where the laptop
    IP may move across interfaces without a backend restart.
    """

    def _origin_verified(self, request):
        if super()._origin_verified(request):
            return True

        origin = request.META.get("HTTP_ORIGIN") or ""
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"}:
            return False
        if not _is_local_dev_host(parsed.hostname):
            return False

        try:
            request_host = request.get_host()
        except Exception:
            return False
        return _is_local_dev_host(request_host)
