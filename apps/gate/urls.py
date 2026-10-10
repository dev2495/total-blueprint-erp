from django.urls import path
from . import views
from . import bill_views
from . import storage_views

urlpatterns = [
    path("inward-bills/", bill_views.BillsView.as_view()),
    path("inward-bills/<uuid:pk>/", bill_views.BillDetailView.as_view()),
    path("inward-bills/<uuid:pk>/pages/<uuid:page_id>/", bill_views.BillPageView.as_view()),
    path("inward-bills/<uuid:pk>/review/", bill_views.BillReviewView.as_view()),
    path("inward-bills/<uuid:pk>/receipt-candidates/", bill_views.BillCandidatesView.as_view()),
    path("inward-bills/<uuid:pk>/link-receipts/", bill_views.BillResolveView.as_view(), {"action": "link-receipts"}),
    path("inward-bills/<uuid:pk>/complete/", bill_views.BillResolveView.as_view(), {"action": "complete"}),
    path("inward-bills/<uuid:pk>/void/", bill_views.BillResolveView.as_view(), {"action": "void"}),
    path("document-pages/rotation/", bill_views.DocumentPageRotationView.as_view()),
    path("document-reports/storage/", storage_views.DocumentStorageView.as_view()),
    path("masters/", views.MastersView.as_view()),
    path("match/", views.MatchView.as_view()),
    path("goods/", views.GoodsView.as_view()),
    path("goods/<uuid:pk>/", views.GoodsDetailView.as_view()),
    path("goods/<uuid:pk>/reconcile/", views.GoodsChangeView.as_view(), {"action": "reconcile"}),
    path("goods/<uuid:pk>/correct/", views.GoodsChangeView.as_view(), {"action": "correct"}),
    path("visitors/", views.VisitorsView.as_view()),
    path("visitors/<uuid:pk>/check-in/", views.VisitorActionView.as_view(), {"action": "check-in"}),
    path("visitors/<uuid:pk>/check-out/", views.VisitorActionView.as_view(), {"action": "check-out"}),
    path("visitors/<uuid:pk>/cancel/", views.VisitorActionView.as_view(), {"action": "cancel"}),
    path("visitors/<uuid:pk>/selfie/", views.SelfieView.as_view()),
    path("summary/", views.SummaryView.as_view()),
    path("audit/", views.AuditView.as_view()),
    path("reports/", views.ReportsView.as_view()),
    path("reports/csv/", views.ReportsCSVView.as_view()),
    path("qr/", views.QRView.as_view()),
    path("qr/<uuid:plant_id>/svg/", views.QRSVGView.as_view()),
    path("public/config/", views.PublicConfigView.as_view()),
    path("public/visitors/", views.PublicVisitorsView.as_view()),
]

# Outward gate documents, document QR and gate passes (workstream D).
from . import gate_pass_views, outward_views, qr_views  # noqa: E402

urlpatterns += [
    path("outward-documents/", outward_views.OutwardListView.as_view()),
    path("outward-documents/<uuid:pk>/", outward_views.OutwardDetailView.as_view()),
    path("outward-documents/<uuid:pk>/pages/<uuid:page_id>/", outward_views.OutwardPageView.as_view()),
    path("outward-documents/<uuid:pk>/candidates/", outward_views.OutwardCandidatesView.as_view()),
    path("outward-documents/<uuid:pk>/link/", outward_views.OutwardActionView.as_view(), {"action": "link"}),
    path("outward-documents/<uuid:pk>/unlink/", outward_views.OutwardActionView.as_view(), {"action": "unlink"}),
    path("outward-documents/<uuid:pk>/discrepancy/", outward_views.OutwardActionView.as_view(), {"action": "discrepancy"}),
    path("outward-documents/<uuid:pk>/resolve/", outward_views.OutwardActionView.as_view(), {"action": "resolve"}),
    path("outward-documents/<uuid:pk>/void/", outward_views.OutwardActionView.as_view(), {"action": "void"}),
    path("qr/resolve/", qr_views.QRResolveView.as_view()),
    path("qr/token/", qr_views.QRTokenView.as_view()),
    path("qr/label.pdf", qr_views.QRLabelView.as_view()),
    path("gate-passes/", gate_pass_views.GatePassListView.as_view()),
    path("gate-passes/open-lines/", gate_pass_views.GatePassOpenLinesView.as_view()),
    path("gate-passes/form-options/", gate_pass_views.GatePassFormOptionsView.as_view()),
    path("gate-passes/<uuid:pk>/", gate_pass_views.GatePassDetailView.as_view()),
    path("gate-passes/<uuid:pk>/print.pdf", gate_pass_views.GatePassPrintView.as_view()),
    path("gate-passes/<uuid:pk>/issue/", gate_pass_views.GatePassActionView.as_view(), {"action": "issue"}),
    path("gate-passes/<uuid:pk>/cancel/", gate_pass_views.GatePassActionView.as_view(), {"action": "cancel"}),
    path("gate-passes/<uuid:pk>/short-close/", gate_pass_views.GatePassActionView.as_view(), {"action": "short-close"}),
    path("gate-passes/<uuid:pk>/receive-back/", gate_pass_views.GatePassActionView.as_view(), {"action": "receive-back"}),
]

# Bills & documents register, office upload, classify/file and reports (workstream B).
from django.urls import re_path  # noqa: E402

urlpatterns += [
    path("inward-bills/office-upload/", bill_views.OfficeUploadView.as_view()),
    path("inward-bills/form-options/", bill_views.BillFormOptionsView.as_view()),
    path("inward-bills/<uuid:pk>/originals/<uuid:file_id>/", bill_views.BillOriginalView.as_view()),
    path("inward-bills/<uuid:pk>/classify/", bill_views.BillActionView.as_view(), {"action": "classify"}),
    path("inward-bills/<uuid:pk>/file/", bill_views.BillActionView.as_view(), {"action": "file"}),
    path("inward-bills/<uuid:pk>/attach/", bill_views.BillActionView.as_view(), {"action": "attach"}),
    path("inward-bills/<uuid:pk>/detach/", bill_views.BillActionView.as_view(), {"action": "detach"}),
    path("inward-bills/<uuid:pk>/reopen/", bill_views.BillActionView.as_view(), {"action": "reopen"}),
    path("document-reports/summary/", bill_views.DocumentReportSummaryView.as_view()),
    re_path(r"^document-reports/register\.csv/?$", bill_views.DocumentRegisterCSVView.as_view()),
]
