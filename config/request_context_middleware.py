import uuid

from .request_context import clear_request_context, set_request_context


class RequestContextMiddleware:
    """Injects request-id/user/role context for logs and response headers."""

    HEADER_NAME = "X-Request-ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get(self.HEADER_NAME, str(uuid.uuid4()))
        user_id = ""
        role = ""
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            user_id = str(getattr(user, "id", "") or "")
            role = str(getattr(getattr(user, "role", None), "code", "") or "")

        set_request_context(request_id=request_id, user_id=user_id, role=role)
        request.request_id = request_id
        response = self.get_response(request)
        response[self.HEADER_NAME] = request_id
        clear_request_context()
        return response
