from django.urls import path

from .views import CompanyProfileView

urlpatterns = [
    path("company-profile/", CompanyProfileView.as_view(), name="company-profile"),
    path("company-profile", CompanyProfileView.as_view()),
]
