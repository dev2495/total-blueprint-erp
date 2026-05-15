from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    PlantLocationListView, LocationViewSet, StockViewSet, GRNViewSet, 
    JobWorkOrderViewSet, DeliveryChallanViewSet,
    RollViewSet, RollMovementListView, RollConsumptionListView,
    BulkInventoryViewSet, BulkTransactionListView, PackagingStockViewSet, PackagingTransactionListView,
    InventoryLedgerView,
    # Phase 58: Observability
    InventoryHealthView, InventoryAlertViewSet, InventorySnapshotViewSet, RollGenealogyView, RollTraceLookupView,
    InventoryV36SnapshotView, InventoryV36RollMatrixView, InventoryV36AnomaliesView, InventoryV36ReservationsView,
    InventoryV36SavedViewsView, InventoryV36SavedViewDetail, InventoryV36ClassSnapshotView,
    InventoryV36CoverageView, InventoryV36SnapshotTrendView, InventoryV36ExportView,
)
from .views_masters import VendorViewSet
from .views_audit import (
    InventoryAuditBatchViewSet,
    InventoryFinancialPeriodViewSet,
    ClosingPreviewView,
    StockCardView,
    StockSnapshotView,
    OpeningStockCsvView,
    OpeningStockManualView,
    OpeningStockFromCountView,
)

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
    path('saved-views/', InventoryV36SavedViewsView.as_view(), name='inventory-v36-saved-views'),
    path('saved-views/<uuid:pk>/', InventoryV36SavedViewDetail.as_view(), name='inventory-v36-saved-view-detail'),
    path('rolls/v36/', InventoryV36ClassSnapshotView.as_view(klass='rolls'), name='inventory-v36-rolls'),
    path('bulk/v36/', InventoryV36ClassSnapshotView.as_view(klass='bulk'), name='inventory-v36-bulk'),
    path('packaging/v36/', InventoryV36ClassSnapshotView.as_view(klass='packaging'), name='inventory-v36-packaging'),
    path('addons/', InventoryV36ClassSnapshotView.as_view(klass='addons'), name='inventory-v36-addons'),
    path('coverage/', InventoryV36CoverageView.as_view(), name='inventory-v36-coverage'),
    path('snapshot/trend/', InventoryV36SnapshotTrendView.as_view(), name='inventory-v36-snapshot-trend'),
    path('snapshot/', InventoryV36SnapshotView.as_view(), name='inventory-v36-snapshot'),
    path('snapshot/roll-matrix/', InventoryV36RollMatrixView.as_view(), name='inventory-v36-roll-matrix'),
    path('anomalies/', InventoryV36AnomaliesView.as_view(), name='inventory-v36-anomalies'),
    path('reservations/', InventoryV36ReservationsView.as_view(), name='inventory-v36-reservations'),
    path('rolls/export/', InventoryV36ExportView.as_view(), {'klass': 'rolls'}, name='inventory-v36-rolls-export'),
    path('bulk/export/', InventoryV36ExportView.as_view(), {'klass': 'bulk'}, name='inventory-v36-bulk-export'),
    path('packaging/export/', InventoryV36ExportView.as_view(), {'klass': 'packaging'}, name='inventory-v36-packaging-export'),
    path('addons/export/', InventoryV36ExportView.as_view(), {'klass': 'addons'}, name='inventory-v36-addons-export'),
    path('ledger/', InventoryLedgerView.as_view(), name='inventory-ledger'),
    path('audit/closing-preview/', ClosingPreviewView.as_view(), name='inventory-audit-closing-preview'),
    path('audit/stock-card/', StockCardView.as_view(), name='inventory-audit-stock-card'),
    path('audit/stock-snapshot/', StockSnapshotView.as_view(), name='inventory-audit-stock-snapshot'),
    path('opening-stock/csv/', OpeningStockCsvView.as_view(), name='inventory-opening-stock-csv'),
    path('opening-stock/manual/', OpeningStockManualView.as_view(), name='inventory-opening-stock-manual'),
    path('opening-stock/from-count/', OpeningStockFromCountView.as_view(), name='inventory-opening-stock-from-count'),
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
