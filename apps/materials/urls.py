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
    ProductMasterViewSet,
    ProductMasterSizeViewSet,
    CustomerProductOverlayViewSet,
    PouchStyleMasterViewSet,
    WebWidthPolicyViewSet,
)
from apps.sales.views_trade import TradingGoodViewSet
from .views_reorder import ReorderPolicyViewSet

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
router.register(r'products', ProductMasterViewSet, basename='product-master')
router.register(r'product-sizes', ProductMasterSizeViewSet, basename='product-master-size')
router.register(r'pouch-styles', PouchStyleMasterViewSet, basename='pouch-style')
router.register(r'web-width-policies', WebWidthPolicyViewSet, basename='web-width-policy')
router.register(r'customer-product-overlays', CustomerProductOverlayViewSet, basename='customer-product-overlay')
router.register(r'trading-goods', TradingGoodViewSet, basename='trading-good')
router.register(r'reorder-policy', ReorderPolicyViewSet, basename='reorder-policy')
router.register(r'inventory-materials', MaterialLibraryViewSet, basename='inventory-materials')

urlpatterns = [
    path('', include(router.urls)),
]
