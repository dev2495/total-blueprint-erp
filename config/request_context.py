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
