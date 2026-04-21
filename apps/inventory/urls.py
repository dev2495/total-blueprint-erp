from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    PlantLocationListView, LocationViewSet, StockViewSet, GRNViewSet, 
    JobWorkOrderViewSet, DeliveryChallanViewSet,
    RollViewSet, RollMovementListView, RollConsumptionListView,
    BulkInventoryViewSet, BulkTransactionListView, PackagingStockViewSet, PackagingTransactionListView,
    InventoryLedgerView,
    # Phase 58: Observability
    InventoryHealthView, InventoryAlertViewSet, InventorySnapshotViewSet, RollGenealogyView, RollTraceLookupView
)
from .views_masters import VendorViewSet
from .views_audit import InventoryAuditBatchViewSet, InventoryFinancialPeriodViewSet, ClosingPreviewView, StockCardView

router = OptionalSlashRouter()
router.register(r'locations', LocationViewSet, basename='location')
router.register(r'stock', StockViewSet, basename='stock')
router.register(r'grn', GRNViewSet, basename='grn')
router.register(r'job-work', JobWorkOrderViewSet, basename='job-work')
router.register(r'vendors', VendorViewSet, basename='vendor')
router.register(r'inter-plant', DeliveryChallanViewSet, basename='inter-plant')
router.register(r'rolls', RollViewSet, basename='roll')  # Phase 54
router.register(r'bulk', BulkInventoryViewSet, basename='bulk')  # Phase 56
router.register(r'packaging/stock', PackagingStockViewSet, basename='packaging-stock')
# Phase 58: Observability
router.register(r'alerts', InventoryAlertViewSet, basename='inventory-alert')
router.register(r'snapshots', InventorySnapshotViewSet, basename='inventory-snapshot')
router.register(r'audit/periods', InventoryFinancialPeriodViewSet, basename='inventory-audit-period')
router.register(r'audit/batches', InventoryAuditBatchViewSet, basename='inventory-audit-batch')

urlpatterns = [
    path('plants/<uuid:pk>/locations/', PlantLocationListView.as_view(), name='plant-location-list'),
    path('ledger/', InventoryLedgerView.as_view(), name='inventory-ledger'),
    path('audit/closing-preview/', ClosingPreviewView.as_view(), name='inventory-audit-closing-preview'),
    path('audit/stock-card/', StockCardView.as_view(), name='inventory-audit-stock-card'),
    # Phase 54 additions
    path('roll-movements/', RollMovementListView.as_view(), name='roll-movement-list'),
    path('roll-consumptions/', RollConsumptionListView.as_view(), name='roll-consumption-list'),
    path('bulk-transactions/', BulkTransactionListView.as_view(), name='bulk-transaction-list'),
    path('packaging/transactions/', PackagingTransactionListView.as_view(), name='packaging-transaction-list'),
    # Phase 58: Observability
    path('health/', InventoryHealthView.as_view(), name='inventory-health'),
    path('rolls/<uuid:pk>/genealogy/', RollGenealogyView.as_view(), name='roll-genealogy'),
    path('roll-trace/', RollTraceLookupView.as_view(), name='roll-trace-lookup'),
    path('', include(router.urls)),
]
