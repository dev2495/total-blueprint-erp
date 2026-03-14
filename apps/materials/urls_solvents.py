from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views_chem import SolventViewSet

router = OptionalSlashRouter()
router.register(r'', SolventViewSet, basename='solvent')

urlpatterns = [
    path('', include(router.urls)),
]
