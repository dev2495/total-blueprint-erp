from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import AddonViewSet

router = OptionalSlashRouter()
router.register(r'', AddonViewSet, basename='addon')

urlpatterns = [
    path('', include(router.urls)),
]
