from rest_framework import serializers
from .models import RecipeGrade, ExtrusionRecipe, ExtrusionRecipeComponent
from apps.materials.models import InventoryMaterial

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

    class Meta:
        model = ExtrusionRecipe
        fields = ['id', 'film_variant', 'film_variant_name', 'grade', 'grade_name', 'thickness_min_micron', 'thickness_max_micron', 'is_active', 'created_at', 'components']
        read_only_fields = ['id', 'created_at']

    def validate_components(self, value):
        total = sum(c['percentage'] for c in value)
        if abs(total - 100) > 0.01:
            raise serializers.ValidationError(f"Total percentage must be 100%. Current: {total}%")
        return value

    def create(self, validated_data):
        components_data = validated_data.pop('components')
        recipe = ExtrusionRecipe.objects.create(**validated_data)
        for comp_data in components_data:
            ExtrusionRecipeComponent.objects.create(recipe=recipe, **comp_data)
        return recipe

    def update(self, instance, validated_data):
        components_data = validated_data.pop('components', None)
        
        # Update fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if components_data is not None:
            # Replace components strategy
            instance.components.all().delete()
            for comp_data in components_data:
                ExtrusionRecipeComponent.objects.create(recipe=instance, **comp_data)
        
        return instance
