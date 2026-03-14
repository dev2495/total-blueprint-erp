from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import FilmFamilyViewSet, FilmVariantViewSet

router = OptionalSlashRouter()
router.register(r'families', FilmFamilyViewSet, basename='film-family')
router.register(r'variants', FilmVariantViewSet, basename='film-variant')

urlpatterns = [
    path('', include(router.urls)),
]
