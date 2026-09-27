"""Authenticated artwork previews, including safe handling of legacy uploads."""
from pathlib import Path
from django.conf import settings
from django.views.static import serve
from rest_framework.views import APIView
from rest_framework.negotiation import DefaultContentNegotiation
from .uploads import ARTWORK_TYPES


class ArtworkContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        # Browsers/file clients can send image/* or application/pdf. FileResponse
        # selects its own type; DRF's renderer is only used for JSON errors.
        return renderers[0], renderers[0].media_type


class ArtworkMediaView(APIView):
    content_negotiation_class = ArtworkContentNegotiation

    def get(self, request, path):
        response = serve(request, path, document_root=Path(settings.MEDIA_ROOT) / 'artworks')
        extension = Path(path).suffix.lower()
        response['Content-Type'] = ARTWORK_TYPES.get(extension, 'application/octet-stream')
        if extension not in ARTWORK_TYPES:
            response['Content-Disposition'] = 'attachment'
        response['Content-Security-Policy'] = "sandbox allow-downloads; default-src 'none'; frame-ancestors 'self'"
        response['X-Content-Type-Options'] = 'nosniff'
        response['X-Frame-Options'] = 'SAMEORIGIN'
        response['Cache-Control'] = 'private, no-store'
        return response


artwork_media_serve = ArtworkMediaView.as_view()
