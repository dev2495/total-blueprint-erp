from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import CylinderViewSet

router = OptionalSlashRouter()
router.register(r'cylinders', CylinderViewSet, basename='cylinder')

urlpatterns = [
    path('', include(router.urls)),
]
