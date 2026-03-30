from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views_catalog import SalesSkuVariantViewSet, SalesSkuViewSet
from .views_customers import CustomerViewSet
from .views_orders import SalesOrderBlockReasonView, SalesOrderViewSet
from .views_quotations import QuotationViewSet

router = OptionalSlashRouter()
router.register(r'orders', SalesOrderViewSet, basename='sales-order')
router.register(r'sku-catalog', SalesSkuViewSet, basename='sales-sku')
router.register(r'sku-variants', SalesSkuVariantViewSet, basename='sales-sku-variant')
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'quotations', QuotationViewSet, basename='quotation')

urlpatterns = [
    path('', include(router.urls)),
    path('orders/<uuid:pk>/block-reasons/', SalesOrderBlockReasonView.as_view(), name='order-block-reasons'),
]
