from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import SalesOrderViewSet
from .views_masters import CustomerViewSet

router = OptionalSlashRouter()
router.register(r'orders', SalesOrderViewSet, basename='sales-order-canonical')
router.register(r'customers', CustomerViewSet, basename='customer-canonical')

urlpatterns = [
    path('', include(router.urls)),
    path('preview-item/', SalesOrderViewSet.as_view({'post': 'preview_item'}), name='sales-preview-item-canonical'),
]
