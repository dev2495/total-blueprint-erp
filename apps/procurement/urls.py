from rest_framework.routers import DefaultRouter

from apps.procurement.views import (
    PurchaseOrderReceiptViewSet,
    PurchaseOrderViewSet,
)

router = DefaultRouter()
router.register(r"purchase-orders", PurchaseOrderViewSet, basename="purchase-orders")
router.register(
    r"purchase-order-receipts",
    PurchaseOrderReceiptViewSet,
    basename="purchase-order-receipts",
)

urlpatterns = router.urls
