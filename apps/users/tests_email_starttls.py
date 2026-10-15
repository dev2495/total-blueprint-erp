from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from apps.users.services.email_service import EmailDeliveryService


class SmtpStarttlsSwitchTests(SimpleTestCase):
    def _send(self, env):
        server = MagicMock()
        smtp = MagicMock()
        smtp.return_value.__enter__.return_value = server
        with patch.dict("os.environ", {"EMAIL_PROVIDER": "SMTP", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "8025", **env}, clear=False), \
             patch("apps.users.services.email_service.smtplib.SMTP", smtp):
            EmailDeliveryService.send_email("s", "<p>b</p>", ["a@example.com"])
        return server

    def test_starttls_is_on_by_default(self):
        server = self._send({})
        server.starttls.assert_called_once()

    def test_starttls_can_be_switched_off_for_a_local_sink(self):
        server = self._send({"SMTP_STARTTLS": "false"})
        server.starttls.assert_not_called()
        server.sendmail.assert_called_once()
