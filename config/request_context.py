import contextlib
import contextvars


_request_id_ctx = contextvars.ContextVar("request_id", default="")
_user_id_ctx = contextvars.ContextVar("user_id", default="")
_role_ctx = contextvars.ContextVar("role", default="")


def set_request_context(request_id: str = "", user_id: str = "", role: str = "") -> None:
    _request_id_ctx.set(request_id or "")
    _user_id_ctx.set(user_id or "")
    _role_ctx.set(role or "")


def clear_request_context() -> None:
    _request_id_ctx.set("")
    _user_id_ctx.set("")
    _role_ctx.set("")


def get_request_context() -> dict:
    return {
        "request_id": _request_id_ctx.get("") or "",
        "user_id": _user_id_ctx.get("") or "",
        "role": _role_ctx.get("") or "",
    }


# Per-request memo for pure read computations (job context, WIP pool, eligible rolls).
# Only armed by the middleware for GET/HEAD requests, so writes never see stale values.
_memo_ctx = contextvars.ContextVar("request_memo", default=None)


def arm_request_memo() -> None:
    _memo_ctx.set({})


def disarm_request_memo() -> None:
    _memo_ctx.set(None)


def request_memo(key, build):
    """Return build() once per request for this key; outside an armed request just call build()."""
    memo = _memo_ctx.get(None)
    if memo is None:
        return build()
    if key in memo:
        return memo[key]
    value = build()
    memo[key] = value
    return value


# Notes for the person who made an entry that went through but left something for later
# (for example inner pouches left for the evening count). A view collects them around one
# service call and returns them as `notices`; outside collect() they are dropped.
_notices_ctx = contextvars.ContextVar("entry_notices", default=None)


@contextlib.contextmanager
def collect_notices():
    token = _notices_ctx.set([])
    try:
        yield _notices_ctx.get()
    finally:
        _notices_ctx.reset(token)


def add_notice(message: str) -> None:
    bucket = _notices_ctx.get(None)
    if bucket is not None and message and message not in bucket:
        bucket.append(message)
