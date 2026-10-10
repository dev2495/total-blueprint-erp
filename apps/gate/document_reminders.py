"""Daily reminders for bills and documents (payment due dates, licence/AMC valid-until).

Runs from Celery beat (``apps.gate.tasks.document_reminders_task``). Each
document alerts the accounts that currently hold ``documents.manage`` once per
threshold: due within 3 days, then overdue; valid-until at 60, 30, 7 and 0 days.
The threshold and the date are part of the dedupe key, so re-running the job is
harmless and a corrected date can alert again.
"""
from datetime import timedelta

from django.db import transaction

from apps.users.services.bill_notifications import publish_document_event, register_document_event

DUE_EVENT = "documents.due_reminder"
VALID_UNTIL_EVENT = "documents.valid_until_reminder"
DUE_SOON_DAYS = 3
OVERDUE_LOOKBACK_DAYS = 30
VALID_UNTIL_THRESHOLDS = (0, 7, 30, 60)
EXPIRED_LOOKBACK_DAYS = 30
OBJECT_TYPE = "GateInwardBill"

register_document_event(DUE_EVENT, "documents.manage")
register_document_event(VALID_UNTIL_EVENT, "documents.manage")


def _label(bill):
    party = bill.vendor.name if bill.vendor_id else (bill.party_name or "Unknown party")
    number = f" {bill.invoice_number}" if bill.invoice_number else ""
    return f"{party}{number}"


def _amount(bill):
    return f" for ₹{bill.total_amount:,.2f}" if bill.total_amount is not None else ""


def due_threshold(days_left):
    if days_left < -OVERDUE_LOOKBACK_DAYS:
        return None
    if days_left < 0:
        return "overdue"
    if days_left <= DUE_SOON_DAYS:
        return "due-soon"
    return None


def valid_until_threshold(days_left):
    if days_left < -EXPIRED_LOOKBACK_DAYS:
        return None
    for threshold in VALID_UNTIL_THRESHOLDS:
        if days_left <= threshold:
            return threshold
    return None


def _publish_due(bill, today):
    days_left = (bill.due_date - today).days
    threshold = due_threshold(days_left)
    if threshold is None:
        return 0
    if threshold == "overdue":
        title = f"Payment overdue: {_label(bill)}"
        message = f"{_label(bill)}{_amount(bill)} was due on {bill.due_date:%d %b %Y} ({-days_left} day{'s' if days_left != -1 else ''} ago). Plant: {bill.plant.name}."
        priority = "HIGH"
    else:
        when = "today" if days_left == 0 else "tomorrow" if days_left == 1 else f"in {days_left} days"
        title = f"Payment due {when}: {_label(bill)}"
        message = f"{_label(bill)}{_amount(bill)} is due on {bill.due_date:%d %b %Y}. Plant: {bill.plant.name}."
        priority = "NORMAL"
    return publish_document_event(
        event_key=DUE_EVENT, plant=bill.plant, object_id=bill.id, object_type=OBJECT_TYPE, title=title, message=message,
        deep_link=f"/inventory/gate-bills/{bill.id}", priority=priority, dedupe_suffix=f"due:{bill.due_date.isoformat()}:{threshold}",
    )


def _publish_valid_until(bill, today):
    days_left = (bill.valid_until - today).days
    threshold = valid_until_threshold(days_left)
    if threshold is None:
        return 0
    if days_left < 0:
        title = f"Expired: {_label(bill)}"
        message = f"The licence / contract on {_label(bill)} expired on {bill.valid_until:%d %b %Y}. Arrange the renewal. Plant: {bill.plant.name}."
        priority = "HIGH"
    elif days_left == 0:
        title = f"Expires today: {_label(bill)}"
        message = f"The licence / contract on {_label(bill)} is valid until today ({bill.valid_until:%d %b %Y}). Plant: {bill.plant.name}."
        priority = "HIGH"
    else:
        title = f"Renewal due in {days_left} days: {_label(bill)}"
        message = f"The licence / contract on {_label(bill)} is valid until {bill.valid_until:%d %b %Y}. Start the renewal. Plant: {bill.plant.name}."
        priority = "HIGH" if threshold <= 7 else "NORMAL"
    return publish_document_event(
        event_key=VALID_UNTIL_EVENT, plant=bill.plant, object_id=bill.id, object_type=OBJECT_TYPE, title=title, message=message,
        deep_link=f"/inventory/gate-bills/{bill.id}", priority=priority, dedupe_suffix=f"valid:{bill.valid_until.isoformat()}:{threshold}",
    )


def run_document_reminders(today=None):
    """Publish due-date and valid-until reminders. Idempotent; returns counts."""
    from apps.gate.models import InwardBillIntake
    from apps.gate.services import gate_today

    today = today or gate_today()
    live = InwardBillIntake.objects.exclude(status="VOID").select_related("plant", "vendor")
    # A filed supporting paper reminds through its own dates only.
    due = live.filter(due_date__isnull=False, due_date__gte=today - timedelta(days=OVERDUE_LOOKBACK_DAYS), due_date__lte=today + timedelta(days=DUE_SOON_DAYS)).order_by("due_date", "id")
    valid = live.filter(valid_until__isnull=False, valid_until__gte=today - timedelta(days=EXPIRED_LOOKBACK_DAYS), valid_until__lte=today + timedelta(days=max(VALID_UNTIL_THRESHOLDS))).order_by("valid_until", "id")
    due_sent = valid_sent = 0
    for bill in due.iterator(chunk_size=200):
        with transaction.atomic():
            due_sent += _publish_due(bill, today)
    for bill in valid.iterator(chunk_size=200):
        with transaction.atomic():
            valid_sent += _publish_valid_until(bill, today)
    return {"date": today.isoformat(), "due_notifications": due_sent, "valid_until_notifications": valid_sent}
