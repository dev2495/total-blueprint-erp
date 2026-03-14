from django.conf import settings
from django.test import SimpleTestCase


class SecurityDevDefaultsTests(SimpleTestCase):
    def test_dev_csrf_trusted_origins_include_local_frontend(self):
        if not getattr(settings, "IS_LOCAL_DEV", False):
            self.skipTest("Hosted environments require explicit CSRF_TRUSTED_ORIGINS env values.")
        trusted = set(settings.CSRF_TRUSTED_ORIGINS)
        self.assertIn("http://localhost:3000", trusted)
        self.assertIn("http://127.0.0.1:3000", trusted)

    def test_dev_allowed_hosts_includes_wildcard(self):
        if not getattr(settings, "IS_LOCAL_DEV", False):
            self.skipTest("Hosted environments must not use wildcard ALLOWED_HOSTS.")
        self.assertIn("*", settings.ALLOWED_HOSTS)
