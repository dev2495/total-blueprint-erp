"""Email delivery service (Resend-first, SMTP fallback)."""

import base64
import logging
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Iterable, Optional

import requests

logger = logging.getLogger(__name__)


class EmailAttachment(dict):
    """Typed dict-like payload for delivery attachments."""


class EmailDeliveryService:
    @staticmethod
    def configuration_status() -> tuple[bool, str]:
        provider = os.getenv("EMAIL_PROVIDER", "RESEND").strip().upper()
        if provider == "RESEND":
            if not os.getenv("RESEND_API_KEY", "").strip():
                return False, "RESEND_API_KEY is not configured"
            if not os.getenv("RESEND_FROM_EMAIL", "").strip():
                return False, "RESEND_FROM_EMAIL is not configured"
            return True, ""
        if not os.getenv("SMTP_HOST", "").strip():
            return False, "SMTP_HOST is not configured"
        return True, ""

    @staticmethod
    def send_email(
        subject: str,
        body: str,
        recipients: Iterable[str],
        idempotency_key: Optional[str] = None,
        attachments: Optional[Iterable[dict]] = None,
    ) -> dict:
        recipients = [r for r in recipients if r]
        if not recipients:
            return {"status": "skipped", "reason": "no_recipients"}
        normalized_attachments = EmailDeliveryService._normalize_attachments(attachments)

        provider = os.getenv("EMAIL_PROVIDER", "RESEND").strip().upper()
        if provider == "RESEND":
            return EmailDeliveryService._send_via_resend(
                subject,
                body,
                recipients,
                idempotency_key,
                normalized_attachments,
            )
        return EmailDeliveryService._send_via_smtp(subject, body, recipients, normalized_attachments)

    @staticmethod
    def _normalize_attachments(attachments: Optional[Iterable[dict]]) -> list[dict]:
        normalized: list[dict] = []
        for row in attachments or []:
            if not isinstance(row, dict):
                continue
            filename = str(row.get("filename") or "").strip()
            content = row.get("content")
            if not filename or not isinstance(content, (bytes, bytearray)):
                continue
            normalized.append(
                {
                    "filename": filename,
                    "content": bytes(content),
                    "content_type": str(row.get("content_type") or "application/octet-stream"),
                }
            )
        return normalized

    @staticmethod
    def _send_via_resend(
        subject: str,
        body: str,
        recipients: list[str],
        idempotency_key: Optional[str],
        attachments: list[dict],
    ) -> dict:
        api_key = os.getenv("RESEND_API_KEY", "").strip()
        from_email = os.getenv("RESEND_FROM_EMAIL", "").strip()
        if not api_key:
            raise RuntimeError("RESEND_API_KEY is not configured")
        if not from_email:
            raise RuntimeError("RESEND_FROM_EMAIL is not configured")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        payload = {
            "from": from_email,
            "to": recipients,
            "subject": subject,
            "html": body,
        }
        if attachments:
            payload["attachments"] = [
                {
                    "filename": attachment["filename"],
                    "content": base64.b64encode(attachment["content"]).decode("ascii"),
                }
                for attachment in attachments
            ]

        response = requests.post("https://api.resend.com/emails", json=payload, headers=headers, timeout=15)
        if response.status_code >= 300:
            raise RuntimeError(f"Resend API failed ({response.status_code}): {response.text}")

        data = response.json() if response.content else {}
        return {"status": "sent", "provider": "RESEND", "provider_message_id": data.get("id", "")}

    @staticmethod
    def _send_via_smtp(subject: str, body: str, recipients: list[str], attachments: list[dict]) -> dict:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASSWORD", "")
        from_email = os.getenv("SMTP_FROM_EMAIL", user or "no-reply@erp.local")

        if not host:
            raise RuntimeError("SMTP_HOST is not configured")

        message = MIMEMultipart()
        message["Subject"] = subject
        message["From"] = from_email
        message["To"] = ", ".join(recipients)
        message.attach(MIMEText(body, "html"))
        for attachment in attachments:
            part = MIMEApplication(attachment["content"], _subtype=attachment["content_type"].split("/")[-1])
            part.add_header("Content-Disposition", "attachment", filename=attachment["filename"])
            message.attach(part)

        with smtplib.SMTP(host, port, timeout=20) as server:
            server.starttls()
            if user:
                server.login(user, password)
            server.sendmail(from_email, recipients, message.as_string())

        return {"status": "sent", "provider": "SMTP", "provider_message_id": ""}
