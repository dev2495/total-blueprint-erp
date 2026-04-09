from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import RecipeGrade, ExtrusionRecipe
from .serializers import RecipeGradeSerializer, ExtrusionRecipeSerializer

class RecipeGradeViewSet(viewsets.ModelViewSet):
    queryset = RecipeGrade.objects.all()
    serializer_class = RecipeGradeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        # Grade master is global. A grade is picked on sales/order snapshots and
        # roll GRNs before recipe resolution checks variant + grade + thickness.
        return super().get_queryset().order_by('name')

class ExtrusionRecipeViewSet(viewsets.ModelViewSet):
    queryset = ExtrusionRecipe.objects.all().select_related('film_variant', 'grade').prefetch_related('components', 'components__granule')
    serializer_class = ExtrusionRecipeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['film_variant', 'grade', 'is_active']
    search_fields = ['film_variant__name', 'film_variant__code']

    @action(detail=False, methods=['get'])
    def resolve(self, request):
        variant_id = request.query_params.get('variant_id')
        grade_id = request.query_params.get('grade_id')
        thickness = request.query_params.get('thickness')

        if not all([variant_id, grade_id, thickness]):
            return Response({"detail": "variant_id, grade_id, and thickness are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            thickness_val = float(thickness)
            recipe = ExtrusionRecipe.objects.filter(
                film_variant_id=variant_id,
                grade_id=grade_id,
                thickness_min_micron__lte=thickness_val,
                thickness_max_micron__gte=thickness_val,
                is_active=True
            ).first()

            if recipe:
                return Response(ExtrusionRecipeSerializer(recipe).data)
            return Response({"detail": "No active recipe found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
