from django.urls import include, path

from config.routers import OptionalSlashRouter
from .views import OpsViewSet

router = OptionalSlashRouter()
router.register(r"", OpsViewSet, basename="ops")

urlpatterns = [
    path("", include(router.urls)),
]
