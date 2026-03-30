from django.urls import include, path

from config.routers import OptionalSlashRouter

from .views import (
    CostAbsorptionGroupViewSet,
    JobCostViewSet,
    JobRuntimeSessionViewSet,
    MaterialCostSnapshotViewSet,
    MonthlyOverheadViewSet,
    OrderCostViewSet,
    PlantCostPoolLineViewSet,
    PlantCostPoolMonthViewSet,
    ProcessCostRateViewSet,
)

router = OptionalSlashRouter()
router.register(r"material-snapshots", MaterialCostSnapshotViewSet)
router.register(r"cost-groups", CostAbsorptionGroupViewSet)
router.register(r"plant-pool-months", PlantCostPoolMonthViewSet)
router.register(r"plant-pool-lines", PlantCostPoolLineViewSet)
router.register(r"process-rates", ProcessCostRateViewSet)
router.register(r"runtime-sessions", JobRuntimeSessionViewSet)
router.register(r"job-costs", JobCostViewSet)
router.register(r"order-costs", OrderCostViewSet)
router.register(r"monthly-overheads", MonthlyOverheadViewSet)

urlpatterns = [
    path("", include(router.urls)),
]
