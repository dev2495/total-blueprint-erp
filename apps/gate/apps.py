from django.apps import AppConfig


class GateConfig(AppConfig):
    name = "apps.gate"
    verbose_name = "Factory gate register"

    def ready(self):
        from . import signals  # noqa: F401
