from django.urls import path
from . import views
from . import bill_views

urlpatterns = [
    path("inward-bills/", bill_views.BillsView.as_view()),
    path("inward-bills/<uuid:pk>/", bill_views.BillDetailView.as_view()),
    path("inward-bills/<uuid:pk>/pages/<uuid:page_id>/", bill_views.BillPageView.as_view()),
    path("inward-bills/<uuid:pk>/review/", bill_views.BillReviewView.as_view()),
    path("inward-bills/<uuid:pk>/receipt-candidates/", bill_views.BillCandidatesView.as_view()),
    path("inward-bills/<uuid:pk>/link-receipts/", bill_views.BillResolveView.as_view(), {"action": "link-receipts"}),
    path("inward-bills/<uuid:pk>/complete/", bill_views.BillResolveView.as_view(), {"action": "complete"}),
    path("inward-bills/<uuid:pk>/void/", bill_views.BillResolveView.as_view(), {"action": "void"}),
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
