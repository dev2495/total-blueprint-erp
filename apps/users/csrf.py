from rest_framework import exceptions
from rest_framework.authentication import CSRFCheck


def enforce_request_csrf(request) -> None:
    """Apply Django CSRF validation to API requests that mutate auth state."""
    check = CSRFCheck(lambda _request: None)
    # Populates request.META["CSRF_COOKIE"] when present.
    check.process_request(request)
    reason = check.process_view(request, None, (), {})
    if reason:
        raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")
