from __future__ import annotations

from django.urls import resolve
from django.urls.exceptions import Resolver404


class ApiSlashCompatMiddleware:
    """
    Allow both `/api/x` and `/api/x/` without redirects.

    Next.js (especially in dev) may normalize trailing slashes, and Django/DRF often
    defines routes with trailing slashes. This middleware rewrites the incoming
    request path *in-memory* to the variant that actually resolves.

    - No redirects (safe for POST/PUT/PATCH/DELETE)
    - Only applies to `/api/*` paths
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if path.startswith("/api/"):
            if not _resolves(path):
                alt = path.rstrip("/") if path.endswith("/") else f"{path}/"
                if alt != path and _resolves(alt):
                    request.path_info = alt
                    request.META["PATH_INFO"] = alt

        return self.get_response(request)


def _resolves(path: str) -> bool:
    try:
        resolve(path)
        return True
    except Resolver404:
        return False

