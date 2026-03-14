from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    PlantViewSet,
    ProcessViewSet,
    WorkCenterViewSet,
    MachineViewSet,
    PlantShiftDefinitionViewSet,
    MachineShiftOverrideViewSet,
)
from apps.inventory.views import PlantLocationListView, LocationViewSet

router = OptionalSlashRouter()
router.register(r'plants', PlantViewSet, basename='plant')
router.register(r'processes', ProcessViewSet, basename='process')
router.register(r'work-centers', WorkCenterViewSet, basename='work-center')
router.register(r'machines', MachineViewSet, basename='machine')
router.register(r'shifts', PlantShiftDefinitionViewSet, basename='shift-definition')
router.register(r'machine-shift-overrides', MachineShiftOverrideViewSet, basename='machine-shift-override')
router.register(r'locations', LocationViewSet, basename='location')

urlpatterns = [
    path('plants/<uuid:pk>/locations/', PlantLocationListView.as_view(), name='plant-location-list'),
    path('', include(router.urls)),
]
