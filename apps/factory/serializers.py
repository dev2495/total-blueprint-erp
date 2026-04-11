import re

from rest_framework import serializers
from .models import (
    Plant,
    PlantLegalProfile,
    Process,
    WorkCenter,
    Machine,
    WorkCenterProcess,
    PlantShiftDefinition,
    MachineShiftOverride,
)
from apps.inventory.serializers import InventoryLocationSerializer


def normalize_machine_code(value: str) -> str:
    normalized = re.sub(r"\s*-\s*", "-", str(value or "").strip())
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.upper()


class PlantLegalProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlantLegalProfile
        fields = [
            'legal_name',
            'gstin',
            'address',
            'contact_phone',
            'contact_email',
            'authorized_signatory_name',
            'authorized_signatory_designation',
            'is_verified',
            'notes',
            'updated_at',
        ]
        read_only_fields = ['updated_at']

class PlantSerializer(serializers.ModelSerializer):
    location_count = serializers.IntegerField(source='locations.count', read_only=True)
    work_center_count = serializers.IntegerField(source='work_centers.count', read_only=True)
    machine_count = serializers.SerializerMethodField()
    legal_profile = PlantLegalProfileSerializer(required=False)
    default_cost_absorption_group_code = serializers.CharField(source='default_cost_absorption_group.code', read_only=True, allow_null=True)

    class Meta:
        model = Plant
        fields = [
            'id',
            'name',
            'code',
            'default_cost_absorption_group',
            'default_cost_absorption_group_code',
            'include_in_official_reports',
            'location_count',
            'work_center_count',
            'machine_count',
            'legal_profile',
        ]

    def get_machine_count(self, obj):
        from .models import Machine
        return Machine.objects.filter(work_center__plant=obj).count()

    def create(self, validated_data):
        legal_data = validated_data.pop('legal_profile', None)
        plant = Plant.objects.create(**validated_data)
        if legal_data:
            PlantLegalProfile.objects.update_or_create(
                plant=plant,
                defaults=legal_data,
            )
        return plant

    def update(self, instance, validated_data):
        legal_data = validated_data.pop('legal_profile', None)
        instance = super().update(instance, validated_data)
        if legal_data is not None:
            PlantLegalProfile.objects.update_or_create(
                plant=instance,
                defaults=legal_data,
            )
        return instance

class ProcessSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        if instance is not None and "roll_behavior" in attrs:
            next_behavior = (attrs.get("roll_behavior") or "").upper()
            current_behavior = (instance.roll_behavior or "").upper()
            if next_behavior != current_behavior:
                raise serializers.ValidationError({
                    "roll_behavior": "roll_behavior is immutable after process creation."
                })
        return attrs

    class Meta:
        model = Process
        fields = [
            'id', 'name', 'code', 
            'input_form', 'output_form', 'roll_behavior',
            'description'
        ]

class WorkCenterSerializer(serializers.ModelSerializer):
    process_codes = serializers.SerializerMethodField()
    processes = serializers.SerializerMethodField()
    process_ids_input = serializers.PrimaryKeyRelatedField(
        queryset=Process.objects.all(), 
        many=True, 
        write_only=True,
        required=False,
        source='processes_write'
    )
    # WIP Location details can be helpful in the list
    wip_location_name = serializers.ReadOnlyField(source='default_wip_location.name')
    default_cost_absorption_group_code = serializers.CharField(source='default_cost_absorption_group.code', read_only=True, allow_null=True)

    class Meta:
        model = WorkCenter
        fields = [
            'id', 'plant', 'name', 'code', 
            'default_cost_absorption_group', 'default_cost_absorption_group_code',
            'default_wip_location', 'wip_location_name', 
            'process_codes', 'processes', 'process_ids_input'
        ]

    def get_process_codes(self, obj):
        return [wp.process.code for wp in obj.center_processes.all()]

    def get_processes(self, obj):
        return [str(wp.process.id) for wp in obj.center_processes.all()]

    def create(self, validated_data):
        processes = validated_data.pop('processes_write', [])
        wc = WorkCenter.objects.create(**validated_data)
        for p in processes:
            WorkCenterProcess.objects.create(work_center=wc, process=p)
        return wc

    def update(self, instance, validated_data):
        processes = validated_data.pop('processes_write', None)
        if processes is not None:
            instance.center_processes.all().delete()
            for p in processes:
                WorkCenterProcess.objects.create(work_center=instance, process=p)
        return super().update(instance, validated_data)

class MachineSerializer(serializers.ModelSerializer):
    work_center_name = serializers.ReadOnlyField(source='work_center.name')
    cost_absorption_group_code = serializers.CharField(source='cost_absorption_group.code', read_only=True, allow_null=True)

    class Meta:
        model = Machine
        fields = ['id', 'work_center', 'work_center_name', 'name', 'code', 'status', 'cost_absorption_group', 'cost_absorption_group_code']
        validators = []

    def validate_code(self, value):
        normalized = normalize_machine_code(value)
        if not normalized:
            raise serializers.ValidationError("Machine code is required.")
        return normalized

    def validate(self, attrs):
        attrs = super().validate(attrs)
        work_center = attrs.get("work_center") or getattr(self.instance, "work_center", None)
        code = attrs.get("code") or getattr(self.instance, "code", None)
        if not work_center or not code:
            return attrs

        existing = Machine.objects.select_related("work_center").filter(work_center=work_center, code=code)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        duplicate = existing.first()
        if duplicate:
            raise serializers.ValidationError({
                "code": f"Machine code '{code}' already belongs to {duplicate.name} in {duplicate.work_center.name}.",
            })
        return attrs


class PlantShiftDefinitionSerializer(serializers.ModelSerializer):
    plant_name = serializers.ReadOnlyField(source='plant.name')
    plant_code = serializers.ReadOnlyField(source='plant.code')

    class Meta:
        model = PlantShiftDefinition
        fields = [
            "id",
            "plant",
            "plant_name",
            "plant_code",
            "code",
            "name",
            "start_time",
            "end_time",
            "crosses_midnight",
            "is_active",
            "priority",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class MachineShiftOverrideSerializer(serializers.ModelSerializer):
    machine_name = serializers.ReadOnlyField(source='machine.name')
    machine_code = serializers.ReadOnlyField(source='machine.code')
    plant_id = serializers.ReadOnlyField(source='machine.work_center.plant_id')

    class Meta:
        model = MachineShiftOverride
        fields = [
            "id",
            "machine",
            "machine_name",
            "machine_code",
            "plant_id",
            "code",
            "name",
            "start_time",
            "end_time",
            "crosses_midnight",
            "is_active",
            "priority",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
