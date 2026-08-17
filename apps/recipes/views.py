from django.db import transaction
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import RecipeGrade, ExtrusionRecipe
from .serializers import RecipeGradeSerializer, ExtrusionRecipeSerializer
from .services import (
    recipe_change_impact,
    recipe_contract,
    record_recipe_revision,
    refresh_open_sales_boms_for_recipe_contracts,
)

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
    queryset = ExtrusionRecipe.objects.all().select_related('film_variant', 'grade').prefetch_related('components', 'components__granule', 'revisions__changed_by')
    serializer_class = ExtrusionRecipeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['film_variant', 'grade', 'is_active']
    search_fields = ['film_variant__name', 'film_variant__code']

    def perform_destroy(self, instance):
        raise ValidationError({
            "detail": "Recipes are production history and cannot be deleted. Disable the recipe instead."
        })

    @action(detail=True, methods=['post'])
    def impact(self, request, pk=None):
        recipe = self.get_object()
        proposed = request.data if isinstance(request.data, dict) else {}
        contract = recipe_contract(recipe)
        if proposed:
            variant_id = str(proposed.get("film_variant") or recipe.film_variant_id)
            grade_id = str(proposed.get("grade") or recipe.grade_id)
            variant = recipe.film_variant.__class__.objects.filter(id=variant_id).first()
            grade = RecipeGrade.objects.filter(id=grade_id).first()
            if not variant or not grade:
                raise ValidationError({"detail": "Choose a valid film variant and grade before checking impact."})
            contract = {
                "film_variant_id": str(variant.id),
                "film_variant_code": variant.code,
                "grade_id": str(grade.id),
                "grade_name": grade.name,
                "thickness_min_micron": int(proposed.get("thickness_min_micron") or recipe.thickness_min_micron),
                "thickness_max_micron": int(proposed.get("thickness_max_micron") or recipe.thickness_max_micron),
            }
        return Response(recipe_change_impact([recipe_contract(recipe), contract]))

    @action(detail=True, methods=['post'])
    def disable(self, request, pk=None):
        with transaction.atomic():
            recipe = ExtrusionRecipe.objects.select_for_update().select_related('film_variant', 'grade').get(pk=pk)
            if not recipe.is_active:
                return Response(ExtrusionRecipeSerializer(recipe, context=self.get_serializer_context()).data)
            impact = recipe_change_impact([recipe_contract(recipe)])
            if not recipe.revisions.exists():
                record_recipe_revision(
                    recipe,
                    event="BASELINE",
                    change_reason="Baseline captured before recipe disable",
                    changed_by=request.user,
                )
            recipe.is_active = False
            recipe.revision_no += 1
            recipe.save(update_fields=["is_active", "revision_no", "updated_at"])
            refresh_result = refresh_open_sales_boms_for_recipe_contracts(
                [recipe_contract(recipe)],
                raise_on_error=True,
            )
            refresh_result.update({
                "matched_total": impact["matched_total"],
                "historical_frozen": impact["frozen"],
            })
            recipe._bom_refresh_stats = refresh_result
            record_recipe_revision(
                recipe,
                event="DISABLE",
                change_reason=str(request.data.get("change_reason") or "Recipe disabled"),
                impact_snapshot={"before_save": impact, "refresh_result": refresh_result},
                changed_by=request.user,
            )
        return Response(ExtrusionRecipeSerializer(recipe, context=self.get_serializer_context()).data)

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
