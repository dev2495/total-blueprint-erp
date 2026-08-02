import json

from rest_framework.renderers import BaseRenderer


class EpsonRawRenderer(BaseRenderer):
    """Negotiation-only renderer for packaged Epson RAW print downloads."""

    media_type = "application/vnd.totalpolyprint.epson-raw"
    format = "tpp"
    charset = None
    render_style = "binary"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return b""
        if isinstance(data, bytes):
            return data
        return json.dumps(data, default=str).encode("utf-8")
