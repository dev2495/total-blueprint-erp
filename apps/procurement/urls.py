from rest_framework.routers import DefaultRouter

from apps.procurement.views import (
    PurchaseOrderReceiptViewSet,
    PurchaseOrderViewSet,
    TradingGoodReceiptViewSet,
)

router = DefaultRouter()
router.register(r"purchase-orders", PurchaseOrderViewSet, basename="purchase-orders")
router.register(
    r"purchase-order-receipts",
    PurchaseOrderReceiptViewSet,
    basename="purchase-order-receipts",
)
router.register(
    r"trading-good-receipts",
    TradingGoodReceiptViewSet,
    basename="trading-good-receipts",
)

urlpatterns = router.urls
