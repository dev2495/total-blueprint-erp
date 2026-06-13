from rest_framework import serializers

from apps.inventory.models import InkFloorCountLine, InkFloorMovement, InkFloorSession


class InkFloorMovementSerializer(serializers.ModelSerializer):
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)
    target_material_code = serializers.CharField(source="target_material.code", read_only=True, allow_null=True)
    target_material_name = serializers.CharField(source="target_material.name", read_only=True, allow_null=True)
    source_location_name = serializers.CharField(source="source_location.name", read_only=True, allow_null=True)
    destination_location_name = serializers.CharField(source="destination_location.name", read_only=True, allow_null=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True)

    class Meta:
        model = InkFloorMovement
        fields = "__all__"


class InkFloorCountLineSerializer(serializers.ModelSerializer):
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)

    class Meta:
        model = InkFloorCountLine
        fields = "__all__"


class InkFloorSessionSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source="location.name", read_only=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    count_lines = InkFloorCountLineSerializer(many=True, read_only=True)

    class Meta:
        model = InkFloorSession
        fields = "__all__"
