from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import MRPViewSet, MRPRequirementViewSet, MRPSuggestionViewSet

router = OptionalSlashRouter()
router.register(r'plans', MRPViewSet, basename='mrp-plans')
router.register(r'requirements', MRPRequirementViewSet, basename='mrp-requirements')
router.register(r'suggestions', MRPSuggestionViewSet, basename='mrp-suggestions')

urlpatterns = [
    path('', include(router.urls)),
]
