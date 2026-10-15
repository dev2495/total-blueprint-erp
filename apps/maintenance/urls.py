from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"schedules", views.MaintenanceScheduleViewSet, basename="maintenance-schedule")
router.register(r"jobs", views.MaintenanceJobViewSet, basename="maintenance-job")
router.register(r"faults", views.MachineFaultViewSet, basename="maintenance-fault")

urlpatterns = [
    path("board/", views.BoardView.as_view(), name="maintenance-board"),
    path("reports/<slug:report>/", views.ReportsView.as_view(), name="maintenance-report"),
    path("machines/<uuid:machine_id>/history/", views.MachineHistoryView.as_view(), name="maintenance-machine-history"),
    path("attachments/", views.AttachmentUploadView.as_view(), name="maintenance-attachment-upload"),
    path("attachments/<uuid:pk>/file/", views.AttachmentFileView.as_view(), name="maintenance-attachment-file"),
    path("qr/targets/", views.QrTargetsView.as_view(), name="maintenance-qr-targets"),
    path("qr/machine/<uuid:machine_id>.svg", views.MachineQrView.as_view(), name="maintenance-qr-machine"),
    path("qr/location/<uuid:location_id>.svg", views.LocationQrView.as_view(), name="maintenance-qr-location"),
    path("scan/machine/<str:code>/", views.MachineScanView.as_view(), name="maintenance-scan-machine"),
    path("scan/location/<str:code>/", views.LocationScanView.as_view(), name="maintenance-scan-location"),
]
urlpatterns += router.urls
