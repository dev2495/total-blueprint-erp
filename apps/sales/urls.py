from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import SalesOrderBlockReasonView, SalesOrderViewSet
from .views_masters import CustomerViewSet

router = OptionalSlashRouter()
router.register(r'orders', SalesOrderViewSet, basename='sales-order')
router.register(r'customers', CustomerViewSet, basename='customer')

urlpatterns = [
    path('', include(router.urls)),
    path('orders/<uuid:pk>/block-reasons/', SalesOrderBlockReasonView.as_view(), name='order-block-reasons'),
]
