from django.apps import AppConfig


class ProcurementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.procurement"
    label = "procurement"
    verbose_name = "Procurement"

    def ready(self):
        # Registers the GENERAL_RECEIPT bill receipt kind in every process
        # (web, Celery, management commands) so bill linking always works.
        from . import general_receipt_services  # noqa: F401
