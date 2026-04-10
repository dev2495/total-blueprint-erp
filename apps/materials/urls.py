from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    FilmFamilyViewSet, 
    FilmVariantViewSet, 
    GranuleViewSet,
    GranuleQualityCodeViewSet,
    InkViewSet, 
    AdhesiveSolventViewSet, 
    AddonViewSet,
    PODViewSet,
    PodSkuViewSet,
    PodSkuVariantViewSet,
    MaterialLibraryViewSet,
    PackagingViewSet,
    CommercialFamilyViewSet,
)

router = OptionalSlashRouter()
router.register(r'film-families', FilmFamilyViewSet, basename='film-family')
router.register(r'film-variants', FilmVariantViewSet, basename='film-variant')
router.register(r'granules', GranuleViewSet, basename='granule')
router.register(r'granule-codes', GranuleQualityCodeViewSet, basename='granule-code')
router.register(r'inks', InkViewSet, basename='ink')
router.register(r'adhesives-solvents', AdhesiveSolventViewSet, basename='adhesive-solvent')
router.register(r'addons', AddonViewSet, basename='addon')
router.register(r'pod', PODViewSet, basename='pod')
router.register(r'pod-skus', PodSkuViewSet, basename='pod-sku')
router.register(r'pod-sku-variants', PodSkuVariantViewSet, basename='pod-sku-variant')
router.register(r'packaging', PackagingViewSet, basename='packaging')
router.register(r'library', MaterialLibraryViewSet, basename='material-library')
router.register(r'commercial-families', CommercialFamilyViewSet, basename='commercial-family')

urlpatterns = [
    path('', include(router.urls)),
]
