from django.urls import path
from . import views

urlpatterns = [
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
