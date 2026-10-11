"""A failed mutation must never commit a partial change.

Requests run inside one database transaction per view (ATOMIC_REQUESTS).
Django rolls that transaction back when the view *raises*, but many views
catch an exception and *return* a 4xx/5xx response instead; the transaction
then committed every write made before the failure (for example the first
rolls of a multi-roll consumption). This hook gives returned error responses
the same guarantee as raised ones: a POST/PUT/PATCH/DELETE whose response
status is >= 400 rolls its request transaction back.

It is installed on the request handler's own ``make_view_atomic``, so it only
ever marks the request transaction it created. Views called directly (tests
with a request factory, internal callers) and views opted out with
``transaction.non_atomic_requests`` are untouched.

Evidence that must outlive the rollback (permission denials, rejected
assignments) goes through ``apps.users.audit_outbox``.
"""
from functools import wraps
from inspect import iscoroutinefunction

from django.core.handlers.base import BaseHandler
from django.db import connections, transaction

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_INSTALLED_FLAG = "_erp_rollback_failed_mutations"
_KEEP_WRITES_ATTR = "_erp_keep_writes_on_error"


def keep_request_writes(request) -> None:
    """Keep this request's writes even if it ends with an error status.

    Call it only after crossing an external boundary that cannot be undone
    (an e-mail handed to the provider), once the evidence of that crossing has
    been written, so a later failure stays auditable.
    """
    setattr(getattr(request, "_request", request), _KEEP_WRITES_ATTR, True)


def _atomic_aliases(view):
    non_atomic = getattr(view, "_non_atomic_requests", set()) or set()
    return [
        alias
        for alias, settings_dict in connections.settings.items()
        if settings_dict.get("ATOMIC_REQUESTS") and alias not in non_atomic
    ]


def install() -> None:
    if getattr(BaseHandler, _INSTALLED_FLAG, False):
        return
    original = BaseHandler.make_view_atomic

    def make_view_atomic(self, view):
        aliases = _atomic_aliases(view)
        if not aliases or iscoroutinefunction(view):
            return original(self, view)

        @wraps(view)
        def rollback_failed_mutation(request, *args, **kwargs):
            response = view(request, *args, **kwargs)
            if (
                str(getattr(request, "method", "") or "").upper() in MUTATING_METHODS
                and int(getattr(response, "status_code", 200) or 200) >= 400
                and not getattr(request, _KEEP_WRITES_ATTR, False)
            ):
                # The view has returned, so the innermost open atomic block on
                # each alias is the request transaction wrapped around it.
                for alias in aliases:
                    transaction.set_rollback(True, using=alias)
            return response

        return original(self, rollback_failed_mutation)

    BaseHandler.make_view_atomic = make_view_atomic
    setattr(BaseHandler, _INSTALLED_FLAG, True)
