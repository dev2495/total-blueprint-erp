from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import InkViewSet

router = OptionalSlashRouter()
router.register(r'', InkViewSet, basename='ink')

urlpatterns = [
    path('', include(router.urls)),
]
