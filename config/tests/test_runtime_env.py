from django.test import SimpleTestCase

from config.runtime_env import (
    is_hosted_secure_env,
    is_local_dev_env,
    is_production_env,
    normalize_django_env,
)


class RuntimeEnvTests(SimpleTestCase):
    def test_normalize_django_env_defaults_to_development(self):
        self.assertEqual(normalize_django_env(""), "development")
        self.assertEqual(normalize_django_env(None), "development")

    def test_local_dev_envs_are_relaxed_only_for_explicit_local_values(self):
        for value in ("development", "dev", "local"):
            self.assertTrue(is_local_dev_env(value))
            self.assertFalse(is_hosted_secure_env(value))

    def test_hosted_envs_include_staging_and_production(self):
        for value in ("staging", "stage", "production", "prod"):
            self.assertTrue(is_hosted_secure_env(value))

    def test_is_production_only_matches_production_values(self):
        self.assertTrue(is_production_env("production"))
        self.assertTrue(is_production_env("prod"))
        self.assertFalse(is_production_env("staging"))
        self.assertFalse(is_production_env("development"))
