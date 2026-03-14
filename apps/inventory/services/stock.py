from django.db.models import Sum
from django.utils import timezone
from apps.inventory.models import InventoryBulk, InventoryRoll, InventoryLocation
from typing import List, Dict, Any

class StockService:
    @classmethod
    def get_bulk_stock(cls, plant_id, location_id=None) -> List[Dict[str, Any]]:
        """
        Get aggregated Bulk Stock for a Plant, optionally filtered by Location.
        Returns a list of dicts with material details and quantity.
        Uses InventoryBulk (Phase 57+ unified model).
        """
        queryset = InventoryBulk.objects.filter(plant_id=plant_id)
        
        if location_id:
            queryset = queryset.filter(location_id=location_id)
            
        # Select related material for efficiency
        queryset = queryset.select_related('material', 'location')
        
        results = []
        for item in queryset:
            if item.qty_kg > 0:
                results.append({
                    'material_id': str(item.material.id),
                    'material_code': item.material.code,
                    'material_name': item.material.name,
                    'location_id': str(item.location.id),
                    'location_name': item.location.name,
                    'quantity': float(item.qty_kg),
                    'uom': 'KG',
                    'avg_cost': float(item.avg_cost) if item.avg_cost else 0
                })
        return results

    @classmethod
    def get_roll_stock(cls, plant_id, location_id=None) -> List[Dict[str, Any]]:
        """
        Get Roll Stock for a Plant, optionally filtered by Location.
        Only returns rolls that are 'AVAILABLE' or 'SENT_JOBWORK' (if tracking off-site).
        Typically for "Stock" view, we want AVAILABLE.
        """
        queryset = InventoryRoll.objects.filter(
            location__plant_id=plant_id,
            status__in=['AVAILABLE', 'SENT_JOBWORK']
        ).select_related('material', 'location')

        if location_id:
            queryset = queryset.filter(location_id=location_id)

        results = []
        for roll in queryset:
            results.append({
                'roll_id': str(roll.id),
                'label_id': roll.label_id,
                'material_code': roll.material.code,
                'material_name': roll.material.name,
                'batch_no': roll.batch_no,
                'thickness_micron': float(roll.thickness_micron),
                'width_mm': float(roll.width_mm),
                'length_m': float(roll.length_m),
                'weight_kg': float(roll.weight_kg),
                'location_name': roll.location.name,
                'status': roll.status,
                'stage_index': roll.stage_index,
                'stage_name': roll.get_stage_name_display() if hasattr(roll, 'get_stage_name_display') else f"Stage {roll.stage_index}",
                'age_days': (timezone.now() - roll.created_at).days if roll.created_at else 0
            })
        return results
