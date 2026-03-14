from decimal import Decimal
from typing import Dict, Any, List
from django.db import transaction
from django.db.models import Q
from .models import MaterialCostSnapshot, ProcessCostRate, JobCost, OrderCost
from apps.production.models import ProductionJob
from apps.sales.models import SalesOrderItem
from apps.materials.models import InventoryMaterial
import logging

logger = logging.getLogger(__name__)

class CostingService:
    @staticmethod
    def get_material_rate(material: InventoryMaterial) -> Decimal:
        """
        Gets the latest frozen rate for a material.
        Fallbacks to a default if no snapshot exists.
        """
        snapshot = MaterialCostSnapshot.objects.filter(material=material).first()
        if snapshot:
            return snapshot.avg_rate_per_kg
        
        # Fallback rates based on categories if no snapshot exists
        if material.category in ['GRANULE', 'INK', 'ADHESIVE', 'SOLVENT']:
            return Decimal('250.00')
        elif material.category == 'FILM_VARIANT':
            return Decimal('180.00')
        elif material.category == 'POD':
            return Decimal('180.00')
        
        return Decimal('100.00')

    @staticmethod
    def calculate_job_cost(job: ProductionJob) -> JobCost:
        """
        Calculates cost for a single production job.
        Process Cost = job.run_time_hours * rate_per_hour
        """
        # 1. Process Cost
        # For now, we estimate runtime based on quantity / machine speed (if speed logic exists)
        # Simplified: Assume 1 hour for every 200kg for now if not tracked
        # TODO: Link with actual ProductionJob tracking once Phase 28/32 is fully live
        estimated_hours = Decimal(str(job.quantity)) / Decimal('200.00')
        
        process_rate = ProcessCostRate.objects.filter(
            Q(machine=job.machine) | Q(process=job.current_process, machine__isnull=True)
        ).order_by('machine').first() # Machine specific rate preferred

        hourly_rate = process_rate.cost_per_hour if process_rate else Decimal('1000.00')
        process_cost = estimated_hours * hourly_rate

        # 2. Material Cost (if applicable at this stage)
        # Note: Material cost is usually aggregated at the Order level in this ERP
        # because the Physics Engine solves the BOM for the whole order.
        material_cost = Decimal('0')

        total_cost = material_cost + process_cost
        
        # 3. Save JobCost
        job_cost, _ = JobCost.objects.update_or_create(
            job=job,
            defaults={
                'material_cost': material_cost,
                'process_cost': process_cost,
                'total_cost': total_cost,
                'cost_per_kg': total_cost / Decimal(str(job.quantity)) if job.quantity > 0 else 0,
                'calculation_log': {
                    'hours': float(estimated_hours),
                    'hourly_rate': float(hourly_rate),
                    'rate_id': str(process_rate.id) if process_rate else None
                }
            }
        )
        return job_cost

    @staticmethod
    @transaction.atomic
    def calculate_order_cost(order_item: SalesOrderItem) -> OrderCost:
        """
        Deterministic math: Material Cost + Conversion Cost.
        """
        bom = order_item.bom_snapshot
        if not bom:
            # If no BOM, we can't calculate material cost
            logger.warning(f"No BOM snapshot for Order Item {order_item.id}. Cannot calculate cost.")
            return None

        # 1. Material Cost Calculation
        total_mat_cost = Decimal('0')
        mat_breakdown = []

        # Iterate through all material types in BOM
        for cat in ['films', 'granules', 'inks', 'chemicals', 'pod']:
            for item in bom.get(cat, []):
                qty = Decimal(str(item.get('weight_kg', 0)))
                mat_id = item.get('material_id') or item.get('variant_id') or item.get('granule_id')
                
                if mat_id:
                    try:
                        material = InventoryMaterial.objects.get(id=mat_id)
                        rate = CostingService.get_material_rate(material)
                        cost = qty * rate
                        total_mat_cost += cost
                        mat_breakdown.append({
                            'code': material.code,
                            'qty': float(qty),
                            'rate': float(rate),
                            'cost': float(cost)
                        })
                    except InventoryMaterial.DoesNotExist:
                        pass

        # 2. Conversion (Process) Cost
        # In this system, conversion cost is based on the routing rules
        total_conv_cost = Decimal('0')
        routing = order_item.template.routing_rule
        if routing:
            # Order Qty in KG
            total_kg = Decimal(str(order_item.total_weight_kg or order_item.qty_value))
            
            for step in routing.ordered_processes:
                process = step['process'] # Assuming routing rule stores process objects or codes
                # Find rate for this process
                rate_obj = ProcessCostRate.objects.filter(process__code=process.code if hasattr(process, 'code') else process).first()
                rate = rate_obj.cost_per_hour if rate_obj else Decimal('800.00')
                
                # Assume throughput of 150kg/hr average for conversion estimation
                est_hours = total_kg / Decimal('150.0')
                conv_cost = est_hours * rate
                total_conv_cost += conv_cost

        total_cost = total_mat_cost + total_conv_cost
        
        # 3. Margin Calculation
        # Assuming selling_price is stored in SO item (might need addition to model if not there)
        # For now, using a placeholder if field doesn't exist
        selling_price = getattr(order_item, 'unit_price', Decimal('0')) * Decimal(str(order_item.qty_value))
        if selling_price == 0:
            # Fictional selling price for demo if not set: 30% markup
            selling_price = total_cost * Decimal('1.3')

        margin_value = selling_price - total_cost
        margin_percent = (margin_value / selling_price * 100) if selling_price > 0 else 0

        # 4. Save/Update OrderCost
        order_cost, _ = OrderCost.objects.update_or_create(
            sales_order_item=order_item,
            defaults={
                'material_cost': total_mat_cost,
                'conversion_cost': total_conv_cost,
                'total_cost': total_cost,
                'selling_price': selling_price,
                'margin_value': margin_value,
                'margin_percent': margin_percent
            }
        )
        return order_cost

    @staticmethod
    def get_financial_summary(year: int = None, month: int = None, date_from=None, date_to=None) -> Dict[str, Any]:
        """
        Derives the actual financial posture for a specific period.
        Revenue = Sum of completed/dispatched Sales Order Item values in this period
        COGS (Material) = Sum of material costs of those Sales Order Items
        Fixed Overheads = Electricity + Labor + Other from `MonthlyOverhead` (scaled if partial)
        Net Profit = Revenue - COGS - Overheads
        """
        from .models import MonthlyOverhead
        from apps.sales.models import SalesOrderItem
        from django.db.models import Sum, F, Case, When, DecimalField, ExpressionWrapper
        from django.utils import timezone

        if not year and not month and not date_from:
            # Default to current month
            today = timezone.now().date()
            year = today.year
            month = today.month

        # Determine filtering kwargs
        filters = {}
        if date_from and date_to:
            filters['sales_order__created_at__date__gte'] = date_from
            filters['sales_order__created_at__date__lte'] = date_to
            filter_year = date_to.year
            filter_month = date_to.month
        elif year and month:
            filters['sales_order__created_at__year'] = year
            filters['sales_order__created_at__month'] = month
            filter_year = year
            filter_month = month
        else:
            filters['sales_order__created_at__year'] = year
            filter_year = year
            filter_month = 1 # dummy

        # Filter Sales Items created or modified in this period
        items = SalesOrderItem.objects.filter(**filters).exclude(sales_order__status="CANCELLED")

        # Get Revenue
        # Following existing logic: total_weight_kg * unit_price (or qty_value * unit_price for PCS)
        revenue_agg = items.aggregate(
            total_rev=Sum(
                Case(
                    When(
                        price_basis="PCS",
                        then=ExpressionWrapper(
                            F("qty_value") * F("unit_price"),
                            output_field=DecimalField(max_digits=18, decimal_places=4),
                        ),
                    ),
                    default=ExpressionWrapper(
                        F("total_weight_kg") * F("unit_price"),
                        output_field=DecimalField(max_digits=18, decimal_places=4),
                    ),
                    output_field=DecimalField(max_digits=18, decimal_places=4),
                )
            )
        )
        revenue = revenue_agg.get('total_rev') or Decimal('0')

        # Get COGS (Material + Conversion) from OrderCost
        # We join on OrderCost to get the pre-calculated costs
        cogs_agg = OrderCost.objects.filter(
            sales_order_item__in=items
        ).aggregate(
            total_mat=Sum('material_cost'),
            total_conv=Sum('conversion_cost')
        )
        
        cogs_material = cogs_agg.get('total_mat') or Decimal('0')
        cogs_conversion = cogs_agg.get('total_conv') or Decimal('0')
        total_cogs = cogs_material + cogs_conversion

        gross_profit = revenue - total_cogs
        gross_margin_pct = (gross_profit / revenue * Decimal('100.0')) if revenue > 0 else Decimal('0')

        # Get Fixed Overheads for the primary month
        overhead = MonthlyOverhead.objects.filter(year=filter_year, month=filter_month).first()
        if overhead:
            electricity = overhead.electricity_cost
            labor = overhead.labor_cost
            other = overhead.other_overheads
        else:
            electricity = Decimal('0')
            labor = Decimal('0')
            other = Decimal('0')

        total_overheads = electricity + labor + other
        
        # Scale overheads if date range is partial month (e.g., Week or Day)
        if date_from and date_to:
            days_in_range_count = (date_to - date_from).days + 1
            if days_in_range_count < 28: # Arbitrary approximation for scaling partial months
                scale_factor = Decimal(str(days_in_range_count)) / Decimal('30.0')
                total_overheads = total_overheads * scale_factor

        net_profit = gross_profit - total_overheads
        net_margin_pct = (net_profit / revenue * Decimal('100.0')) if revenue > 0 else Decimal('0')

        return {
            'period': f"{filter_year}-{filter_month:02d}",
            'revenue': float(revenue),
            'cogs_material': float(cogs_material),
            'cogs_conversion': float(cogs_conversion),
            'total_cogs': float(total_cogs),
            'gross_profit': float(gross_profit),
            'gross_margin_pct': float(gross_margin_pct),
            'overheads': {
                'electricity': float(electricity),
                'labor': float(labor),
                'other': float(other),
                'total_overheads': float(total_overheads)
            },
            'net_profit': float(net_profit),
            'net_margin_pct': float(net_margin_pct)
        }
