from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import ProductionJobViewSet, WorkCenterAssignmentViewSet, OperatorViewSet, PackingViewSet, DeliveryChallanViewSet, PlannedStockOrderViewSet, PlannedBulkStockOrderViewSet, ExecutionViewSet, PlannerSkuViewSet, PlannerSkuVariantViewSet

from .views_wc import WCQueueViewSet, JobAllocationViewSet
from .views_planner import PlannerViewSet
from .views_limitless import WCMExecutionViewSet

# Machine Terminal API
from .views_machine import (
    machine_detail, machine_queue,
    machine_start_job, machine_stop_job, machine_log_output, machine_complete_job,
    machine_job_context, machine_job_satisfaction, machine_history,
    machine_log_scrap, operator_machines
)

router = OptionalSlashRouter()
router.register(r'jobs', ProductionJobViewSet, basename='production-job')
# ... existing routes ...
router.register(r'assignments', WorkCenterAssignmentViewSet, basename='production-assignment')
router.register(r'operator', OperatorViewSet, basename='operator')
router.register(r'packing', PackingViewSet, basename='packing')
router.register(r'challans', DeliveryChallanViewSet, basename='challan')
router.register(r'stock-orders', PlannedStockOrderViewSet, basename='stock-order')
router.register(r'bulk-stock-orders', PlannedBulkStockOrderViewSet, basename='bulk-stock-order')
router.register(r'planner/sku-catalog', PlannerSkuViewSet, basename='planner-sku')
router.register(r'planner/sku-variants', PlannerSkuVariantViewSet, basename='planner-sku-variant')
router.register(r'wc/(?P<wc_id>[^/.]+)', WCQueueViewSet, basename='wc-queue')
router.register(r'wc-allocation', JobAllocationViewSet, basename='wc-allocation')
router.register(r'planner', PlannerViewSet, basename='planner')
router.register(r'execution', WCMExecutionViewSet, basename='execution')
router.register(r'flow-engine', ExecutionViewSet, basename='flow-engine')  # Phase 68

urlpatterns = [
    path('', include(router.urls)),
    
    # Machine Terminal API - Machine-Centric Execution
    path('machine/<uuid:machine_id>/', machine_detail, name='machine-detail'),
    path('machine/<uuid:machine_id>/queue/', machine_queue, name='machine-queue'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/start/', machine_start_job, name='machine-start-job'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/stop/', machine_stop_job, name='machine-stop-job'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/log-output/', machine_log_output, name='machine-log-output'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/complete/', machine_complete_job, name='machine-complete-job'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/context/', machine_job_context, name='machine-job-context'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/satisfaction/', machine_job_satisfaction, name='machine-job-satisfaction'),
    path('machine/<uuid:machine_id>/history/', machine_history, name='machine-history'),
    path('machine/<uuid:machine_id>/jobs/<uuid:job_id>/log-scrap/', machine_log_scrap, name='machine-log-scrap'),
    path('operator/machines/', operator_machines, name='operator-machines'),
]
