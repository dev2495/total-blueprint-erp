from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views_chem import AdhesiveViewSet

router = OptionalSlashRouter()
router.register(r'', AdhesiveViewSet, basename='adhesive')

urlpatterns = [
    path('', include(router.urls)),
]
