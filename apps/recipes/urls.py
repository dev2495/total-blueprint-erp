from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import RecipeGradeViewSet, ExtrusionRecipeViewSet

router = OptionalSlashRouter()
router.register(r'grades', RecipeGradeViewSet, basename='recipe-grade')
router.register(r'recipes', ExtrusionRecipeViewSet, basename='extrusion-recipe')

urlpatterns = [
    path('', include(router.urls)),
]
