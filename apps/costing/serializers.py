from rest_framework import serializers
from .models import MaterialCostSnapshot, ProcessCostRate, JobCost, OrderCost, MonthlyOverhead

class MaterialCostSnapshotSerializer(serializers.ModelSerializer):
    material_code = serializers.CharField(source='material.code', read_only=True)
    material_name = serializers.CharField(source='material.name', read_only=True)

    class Meta:
        model = MaterialCostSnapshot
        fields = ['id', 'material', 'material_code', 'material_name', 'avg_rate_per_kg', 'uom', 'effective_date']

class ProcessCostRateSerializer(serializers.ModelSerializer):
    process_name = serializers.CharField(source='process.name', read_only=True)
    process_code = serializers.CharField(source='process.code', read_only=True)
    machine_name = serializers.CharField(source='machine.name', read_only=True, allow_null=True)
    machine_code = serializers.CharField(source='machine.code', read_only=True, allow_null=True)

    class Meta:
        model = ProcessCostRate
        fields = [
            'id', 'process', 'process_name', 'process_code', 'machine', 'machine_name', 'machine_code',
            'cost_per_hour', 'power_cost_per_hour', 'labor_cost_per_hour', 'overhead_cost_per_hour',
            'is_active'
        ]

class JobCostSerializer(serializers.ModelSerializer):
    job_number = serializers.CharField(source='job.job_number', read_only=True)

    class Meta:
        model = JobCost
        fields = [
            'id', 'job', 'job_number', 'material_cost', 'process_cost', 'total_cost',
            'cost_per_kg', 'cost_per_piece', 'calculation_log'
        ]

class OrderCostSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source='sales_order_item.sales_order.order_number', read_only=True)
    customer_name = serializers.CharField(source='sales_order_item.sales_order.customer_name', read_only=True)
    product_name = serializers.CharField(source='sales_order_item.template.name', read_only=True)

    class Meta:
        model = OrderCost
        fields = [
            'id', 'sales_order_item', 'order_number', 'customer_name', 'product_name',
            'material_cost', 'conversion_cost', 'total_cost', 'selling_price',
            'margin_value', 'margin_percent', 'is_frozen', 'created_at'
        ]

class MonthlyOverheadSerializer(serializers.ModelSerializer):
    class Meta:
        model = MonthlyOverhead
        fields = '__all__'
