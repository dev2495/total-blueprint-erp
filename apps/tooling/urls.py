from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import CylinderSlotAssignmentViewSet, CylinderViewSet, ToolAssetViewSet

router = OptionalSlashRouter()
router.register(r'cylinders', CylinderViewSet, basename='cylinder')
router.register(r'cylinder-slot-assignments', CylinderSlotAssignmentViewSet, basename='cylinder-slot-assignment')
router.register(r'assets', ToolAssetViewSet, basename='tool-asset')

urlpatterns = [
    path('', include(router.urls)),
]
