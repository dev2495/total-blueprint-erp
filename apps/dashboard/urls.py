from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import DashboardViewSet

router = OptionalSlashRouter()
router.register(r'', DashboardViewSet, basename='dashboard')

urlpatterns = [
    path('', include(router.urls)),
]
