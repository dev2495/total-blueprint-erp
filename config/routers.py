from rest_framework.routers import DefaultRouter


class OptionalSlashRouter(DefaultRouter):
    """
    Router wrapper for future flexibility.
    Currently uses standard DRF trailing slash behavior ("/").
    """
    pass
