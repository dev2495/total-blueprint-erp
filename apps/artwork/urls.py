from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import ArtworkViewSet

router = OptionalSlashRouter()
router.register(r'artworks', ArtworkViewSet, basename='artwork')

urlpatterns = [
    path('', include(router.urls)),
]
