from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from .models import RecipeGrade, ExtrusionRecipe, ExtrusionRecipeComponent
from .services import recipe_contract, refresh_open_sales_boms_for_recipe_contracts

class RecipeGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecipeGrade
        fields = '__all__'

class ExtrusionRecipeComponentSerializer(serializers.ModelSerializer):
    granule_name = serializers.CharField(source='granule.name', read_only=True)
    granule_code = serializers.CharField(source='granule.code', read_only=True)

    class Meta:
        model = ExtrusionRecipeComponent
        fields = ['id', 'granule', 'granule_name', 'granule_code', 'percentage']

class ExtrusionRecipeSerializer(serializers.ModelSerializer):
    components = ExtrusionRecipeComponentSerializer(many=True)
    film_variant_name = serializers.CharField(source='film_variant.name', read_only=True)
    grade_name = serializers.CharField(source='grade.name', read_only=True)
    bom_refresh = serializers.SerializerMethodField()

    class Meta:
        model = ExtrusionRecipe
        fields = ['id', 'film_variant', 'film_variant_name', 'grade', 'grade_name', 'thickness_min_micron', 'thickness_max_micron', 'is_active', 'created_at', 'components', 'bom_refresh']
        read_only_fields = ['id', 'created_at']
        validators = []

    @staticmethod
    def _round_percentage(value):
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def get_bom_refresh(self, obj):
        return getattr(obj, "_bom_refresh_stats", None)

    def validate_components(self, value):
        total = sum(self._round_percentage(c['percentage']) for c in value)
        if abs(total - Decimal("100.00")) > Decimal("0.05"):
            raise serializers.ValidationError(f"Total percentage must be 100.00%. Current: {total}%")
        return value

    def validate(self, attrs):
        thickness_min = attrs.get("thickness_min_micron", getattr(self.instance, "thickness_min_micron", None))
        thickness_max = attrs.get("thickness_max_micron", getattr(self.instance, "thickness_max_micron", None))
        if thickness_min is not None and thickness_max is not None and thickness_min > thickness_max:
            raise serializers.ValidationError({
                "thickness_max_micron": "Max thickness must be greater than or equal to min thickness."
            })

        components = attrs.get("components")
        if components is not None:
            seen_granules = set()
            duplicate_codes = []
            for component in components:
                granule = component.get("granule")
                granule_id = str(getattr(granule, "id", granule))
                if granule_id in seen_granules:
                    duplicate_codes.append(getattr(granule, "code", str(granule)))
                seen_granules.add(granule_id)
            if duplicate_codes:
                duplicates = ", ".join(sorted(set(duplicate_codes)))
                raise serializers.ValidationError({
                    "components": f"Each granule can be used only once in a recipe. Duplicate rows: {duplicates}."
                })

        film_variant = attrs.get("film_variant", getattr(self.instance, "film_variant", None))
        grade = attrs.get("grade", getattr(self.instance, "grade", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))

        if film_variant and grade and thickness_min is not None and thickness_max is not None and is_active:
            conflicting_recipes = ExtrusionRecipe.objects.filter(
                film_variant=film_variant,
                grade=grade,
                is_active=True,
            )
            if self.instance is not None:
                conflicting_recipes = conflicting_recipes.exclude(pk=self.instance.pk)

            exact_duplicate = conflicting_recipes.filter(
                thickness_min_micron=thickness_min,
                thickness_max_micron=thickness_max,
            ).first()
            if exact_duplicate:
                raise serializers.ValidationError({
                    "non_field_errors": [
                        f"An active recipe already exists for {film_variant.name} / {grade.name} at {thickness_min}-{thickness_max}μ."
                    ]
                })

            overlapping_recipe = conflicting_recipes.filter(
                thickness_min_micron__lte=thickness_max,
                thickness_max_micron__gte=thickness_min,
            ).first()
            if overlapping_recipe:
                raise serializers.ValidationError({
                    "non_field_errors": [
                        f"Thickness range overlaps with active recipe {overlapping_recipe.thickness_min_micron}-{overlapping_recipe.thickness_max_micron}μ for {film_variant.name} / {grade.name}."
                    ]
                })

        return attrs

    def create(self, validated_data):
        components_data = validated_data.pop('components')
        try:
            with transaction.atomic():
                recipe = ExtrusionRecipe.objects.create(**validated_data)
                for comp_data in components_data:
                    comp_data['percentage'] = float(self._round_percentage(comp_data.get('percentage')))
                    ExtrusionRecipeComponent.objects.create(recipe=recipe, **comp_data)
                recipe._bom_refresh_stats = refresh_open_sales_boms_for_recipe_contracts(
                    [recipe_contract(recipe)],
                    raise_on_error=True,
                )
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"bom_refresh": exc.messages}) from exc
        return recipe

    def update(self, instance, validated_data):
        previous_contract = recipe_contract(instance)
        components_data = validated_data.pop('components', None)
        try:
            with transaction.atomic():
                for attr, value in validated_data.items():
                    setattr(instance, attr, value)
                instance.save()

                if components_data is not None:
                    instance.components.all().delete()
                    for comp_data in components_data:
                        comp_data['percentage'] = float(self._round_percentage(comp_data.get('percentage')))
                        ExtrusionRecipeComponent.objects.create(recipe=instance, **comp_data)

                instance._bom_refresh_stats = refresh_open_sales_boms_for_recipe_contracts(
                    [previous_contract, recipe_contract(instance)],
                    raise_on_error=True,
                )
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"bom_refresh": exc.messages}) from exc
        return instance
