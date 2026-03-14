from __future__ import annotations


class HeadResponseCleanupMiddleware:
    """
    Ensure HEAD responses never carry a response body.

    Some proxy clients (including Next's server proxy) can fail when upstream HEAD
    responses include body bytes. This middleware strips body bytes for HEAD while
    preserving headers/status.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if request.method == "HEAD":
            if getattr(response, "streaming", False):
                response.streaming_content = ()
            else:
                response.content = b""
            response["Content-Length"] = "0"

        return response
