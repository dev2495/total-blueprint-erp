from rest_framework import serializers

from .models import (
    CostAbsorptionGroup,
    JobCost,
    JobRuntimeSession,
    MaterialCostSnapshot,
    MonthlyOverhead,
    OrderCost,
    PlantCostPoolLine,
    PlantCostPoolMonth,
    ProcessCostRate,
)


class MaterialCostSnapshotSerializer(serializers.ModelSerializer):
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)

    class Meta:
        model = MaterialCostSnapshot
        fields = ["id", "material", "material_code", "material_name", "avg_rate_per_kg", "uom", "effective_date"]


class CostAbsorptionGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostAbsorptionGroup
        fields = [
            "id",
            "code",
            "label",
            "description",
            "default_intensity_factor",
            "is_active",
            "created_at",
            "updated_at",
        ]


class PlantCostPoolLineSerializer(serializers.ModelSerializer):
    cost_group_code = serializers.CharField(source="cost_group.code", read_only=True)
    cost_group_label = serializers.CharField(source="cost_group.label", read_only=True)
    pool_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = PlantCostPoolLine
        fields = [
            "id",
            "month_record",
            "cost_group",
            "cost_group_code",
            "cost_group_label",
            "entry_mode",
            "allocation_percent",
            "electricity_cost",
            "labor_cost",
            "overhead_cost",
            "maintenance_cost",
            "service_burden_cost",
            "pool_total",
            "created_at",
            "updated_at",
        ]


class PlantCostPoolMonthSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True)
    lines = PlantCostPoolLineSerializer(many=True, read_only=True)

    class Meta:
        model = PlantCostPoolMonth
        fields = [
            "id",
            "plant",
            "plant_name",
            "plant_code",
            "year",
            "month",
            "entry_mode",
            "status",
            "plant_total_electricity",
            "plant_total_labor",
            "plant_total_overhead",
            "plant_total_maintenance",
            "plant_total_service_burden",
            "notes",
            "created_at",
            "updated_at",
            "lines",
        ]


class ProcessCostRateSerializer(serializers.ModelSerializer):
    process_name = serializers.CharField(source="process.name", read_only=True)
    process_code = serializers.CharField(source="process.code", read_only=True)
    machine_name = serializers.CharField(source="machine.name", read_only=True, allow_null=True)
    machine_code = serializers.CharField(source="machine.code", read_only=True, allow_null=True)

    class Meta:
        model = ProcessCostRate
        fields = [
            "id",
            "process",
            "process_name",
            "process_code",
            "machine",
            "machine_name",
            "machine_code",
            "cost_per_hour",
            "power_cost_per_hour",
            "labor_cost_per_hour",
            "overhead_cost_per_hour",
            "is_active",
        ]


class JobRuntimeSessionSerializer(serializers.ModelSerializer):
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True)
    work_center_code = serializers.CharField(source="work_center.code", read_only=True, allow_null=True)
    machine_code = serializers.CharField(source="machine.code", read_only=True, allow_null=True)
    cost_group_code = serializers.CharField(source="cost_absorption_group.code", read_only=True, allow_null=True)

    class Meta:
        model = JobRuntimeSession
        fields = [
            "id",
            "job",
            "job_number",
            "plant",
            "plant_code",
            "work_center",
            "work_center_code",
            "machine",
            "machine_code",
            "process",
            "cost_absorption_group",
            "cost_group_code",
            "started_at",
            "ended_at",
            "started_by",
            "ended_by",
            "close_reason",
            "notes",
            "created_at",
        ]


class JobCostSerializer(serializers.ModelSerializer):
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True, allow_null=True)
    cost_group_code = serializers.CharField(source="cost_absorption_group.code", read_only=True, allow_null=True)

    class Meta:
        model = JobCost
        fields = [
            "id",
            "job",
            "job_number",
            "plant",
            "plant_code",
            "cost_absorption_group",
            "cost_group_code",
            "material_cost",
            "process_cost",
            "overhead_cost_absorbed",
            "total_cost",
            "material_cost_actual",
            "conversion_cost_actual",
            "runtime_minutes_productive",
            "costing_mode",
            "actual_cost_coverage_pct",
            "coverage_flags",
            "cost_per_kg",
            "cost_per_piece",
            "calculation_log",
            "created_at",
            "updated_at",
        ]


class OrderCostSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="sales_order_item.sales_order.order_number", read_only=True)
    customer_name = serializers.CharField(source="sales_order_item.sales_order.customer_name", read_only=True)
    product_name = serializers.CharField(source="sales_order_item.template.name", read_only=True)
    sku_code = serializers.CharField(source="sales_order_item.sku_variant.code", read_only=True, allow_null=True)

    class Meta:
        model = OrderCost
        fields = [
            "id",
            "sales_order_item",
            "order_number",
            "customer_name",
            "product_name",
            "sku_code",
            "material_cost",
            "conversion_cost",
            "overhead_cost_absorbed",
            "total_cost",
            "material_cost_actual",
            "conversion_cost_actual",
            "selling_price",
            "contribution_margin",
            "contribution_margin_percent",
            "absorbed_margin",
            "absorbed_margin_percent",
            "margin_value",
            "margin_percent",
            "costing_mode",
            "actual_cost_coverage_pct",
            "coverage_flags",
            "is_frozen",
            "created_at",
            "updated_at",
        ]


class MonthlyOverheadSerializer(serializers.ModelSerializer):
    class Meta:
        model = MonthlyOverhead
        fields = "__all__"
