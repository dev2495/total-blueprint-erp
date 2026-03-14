from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import TemplateBlueprintViewSet

router = OptionalSlashRouter()
router.register(r'', TemplateBlueprintViewSet, basename='template')


urlpatterns = [
    path('', include(router.urls)),
]
