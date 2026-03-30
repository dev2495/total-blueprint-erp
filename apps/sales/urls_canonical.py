from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views_catalog import SalesSkuVariantViewSet, SalesSkuViewSet
from .views_customers import CustomerViewSet
from .views_orders import SalesOrderBlockReasonView, SalesOrderViewSet
from .views_quotations import QuotationViewSet

router = OptionalSlashRouter()
router.register(r'orders', SalesOrderViewSet, basename='sales-order-canonical')
router.register(r'sku-catalog', SalesSkuViewSet, basename='sales-sku-canonical')
router.register(r'sku-variants', SalesSkuVariantViewSet, basename='sales-sku-variant-canonical')
router.register(r'customers', CustomerViewSet, basename='customer-canonical')
router.register(r'quotations', QuotationViewSet, basename='sales-quotation-canonical')

urlpatterns = [
    path('', include(router.urls)),
    path('preview-item/', SalesOrderViewSet.as_view({'post': 'preview_item'}), name='sales-preview-item-canonical'),
    path('orders/<uuid:pk>/block-reasons/', SalesOrderBlockReasonView.as_view(), name='sales-order-block-reasons-canonical'),
]
