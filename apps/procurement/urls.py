from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.procurement import general_receipt_views

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

urlpatterns = [
    # General Receipts (non-stock goods and services). Static paths precede <uuid>.
    path("general-receipts/", general_receipt_views.GeneralReceiptsView.as_view()),
    path("general-receipts/machine-history/", general_receipt_views.MachineHistoryView.as_view()),
    path("general-receipts/suggestions/", general_receipt_views.SuggestionsView.as_view()),
    path("general-receipts/options/", general_receipt_views.OptionsView.as_view()),
    path("general-receipts/<uuid:pk>/", general_receipt_views.GeneralReceiptDetailView.as_view()),
    path("general-receipts/<uuid:pk>/reverse/", general_receipt_views.GeneralReceiptReverseView.as_view()),
] + router.urls
