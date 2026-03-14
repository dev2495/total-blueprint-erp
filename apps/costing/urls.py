from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    MaterialCostSnapshotViewSet, ProcessCostRateViewSet,
    JobCostViewSet, OrderCostViewSet, MonthlyOverheadViewSet
)

router = OptionalSlashRouter()
router.register(r'material-snapshots', MaterialCostSnapshotViewSet)
router.register(r'process-rates', ProcessCostRateViewSet)
router.register(r'job-costs', JobCostViewSet)
router.register(r'order-costs', OrderCostViewSet)
router.register(r'monthly-overheads', MonthlyOverheadViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
