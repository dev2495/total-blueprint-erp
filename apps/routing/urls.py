from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import RoutingRuleViewSet

router = OptionalSlashRouter()
router.register(r'rules', RoutingRuleViewSet, basename='routing-rule')

urlpatterns = [
    path('', include(router.urls)),
]
