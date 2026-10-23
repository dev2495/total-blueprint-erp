"""The job name sales types when placing an order (SalesOrder.order_name).

Orders placed without one used to get "Order YYYY-MM-DD" filled in; that is not a job name
and is never shown as one.
"""
import re

_AUTO = re.compile(r"^order \d{4}-\d{2}-\d{2}$", re.I)


def clean_job_name(value) -> str:
    text = str(value or "").strip()
    return "" if not text or _AUTO.match(text) else text


def job_name_of(order) -> str:
    return clean_job_name(getattr(order, "order_name", "") if order is not None else "")
