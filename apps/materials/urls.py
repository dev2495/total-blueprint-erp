from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    FilmFamilyViewSet, 
    FilmVariantViewSet, 
    GranuleViewSet, 
    InkViewSet, 
    AdhesiveSolventViewSet, 
    AddonViewSet,
    PODViewSet,
    MaterialLibraryViewSet,
    PackagingViewSet,
)

router = OptionalSlashRouter()
router.register(r'film-families', FilmFamilyViewSet, basename='film-family')
router.register(r'film-variants', FilmVariantViewSet, basename='film-variant')
router.register(r'granules', GranuleViewSet, basename='granule')
router.register(r'inks', InkViewSet, basename='ink')
router.register(r'adhesives-solvents', AdhesiveSolventViewSet, basename='adhesive-solvent')
router.register(r'addons', AddonViewSet, basename='addon')
router.register(r'pod', PODViewSet, basename='pod')
router.register(r'packaging', PackagingViewSet, basename='packaging')
router.register(r'library', MaterialLibraryViewSet, basename='material-library')

urlpatterns = [
    path('', include(router.urls)),
]
