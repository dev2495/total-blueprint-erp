from django.apps import AppConfig

class InventoryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.inventory'

    def ready(self):
        import apps.inventory.signals
        # Job work registers its QR kind (JOBWORK_CHALLAN), outward search,
        # bill receipt kind (JOBWORK_RETURN) and overdue notification event.
        import apps.inventory.services.job_work_integrations  # noqa: F401

