"""
Phase 56: Material Consumption Service

Core routing engine for material consumption.
Routes to BulkService or RollService based on process input form.

Design Rule: Never deduct inventory directly. Always via services.
"""

from django.core.exceptions import ValidationError
from apps.materials.models import InventoryMaterial
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService


class MaterialService:
    """
    Routes consumption calls to the appropriate service based on material type
    and process configuration.
    """
    
    # Material categories that use bulk inventory
    BULK_CATEGORIES = ['GRANULE', 'INK', 'ADHESIVE', 'SOLVENT', 'POD']
    
    # Material categories that use roll inventory
    ROLL_CATEGORIES = ['FILM_FAMILY', 'FILM_VARIANT']
    
    @classmethod
    def consume_by_process(cls, process, material_id, qty, location_id, job_id=None, **kwargs):
        """
        Consume material based on process input form.
        
        Args:
            process: Process model instance (has input_form field)
            material_id: UUID of the material
            qty: Quantity to consume
            location_id: UUID of the location
            job_id: Optional production job ID
            
        Returns:
            Transaction record (BulkTransaction or RollConsumption)
        """
        if process.input_form == 'BULK':
            return BulkService.consume_bulk(
                material_id=material_id,
                qty=qty,
                location_id=location_id,
                job_id=job_id,
                reference=kwargs.get('reference', f"Job {job_id}")
            )
        elif process.input_form == 'ROLL':
            # Roll consumption requires the actual roll object
            roll = kwargs.get('roll')
            if not roll:
                raise ValidationError("Roll consumption requires 'roll' parameter")
            
            machine = kwargs.get('machine')
            if not machine:
                raise ValidationError("Roll consumption requires 'machine' parameter")
            
            from apps.production.models import ProductionJob
            job = ProductionJob.objects.get(id=job_id) if job_id else None
            
            return RollService.consume_roll(
                input_roll=roll,
                job=job,
                process=process,
                machine=machine,
                used_kg=qty,
                scrap_kg=kwargs.get('scrap_kg', 0),
                output_location=kwargs.get('output_location'),
                user=kwargs.get('user'),
                notes=kwargs.get('notes', '')
            )
        else:
            raise ValidationError(f"Unknown input form: {process.input_form}")
    
    @classmethod
    def consume_bulk(cls, material_id, qty, location_id, job_id=None, reference=""):
        """
        Direct bulk consumption (shortcut for processes that only consume bulk).
        """
        return BulkService.consume_bulk(
            material_id=material_id,
            qty=qty,
            location_id=location_id,
            job_id=job_id,
            reference=reference
        )
    
    @classmethod
    def consume_roll(cls, roll, job, process, machine, used_kg, scrap_kg=0, **kwargs):
        """
        Direct roll consumption (shortcut for processes that only consume rolls).
        """
        return RollService.consume_roll(
            input_roll=roll,
            job=job,
            process=process,
            machine=machine,
            used_kg=used_kg,
            scrap_kg=scrap_kg,
            output_location=kwargs.get('output_location'),
            user=kwargs.get('user'),
            notes=kwargs.get('notes', '')
        )
    
    @classmethod
    def get_material_type(cls, material_id):
        """
        Determine if a material is BULK or ROLL based on its category.
        
        Returns:
            'BULK' or 'ROLL'
        """
        material = InventoryMaterial.objects.get(id=material_id)
        
        if material.category in cls.BULK_CATEGORIES:
            return 'BULK'
        elif material.category in cls.ROLL_CATEGORIES:
            return 'ROLL'
        else:
            raise ValidationError(f"Unknown material category: {material.category}")
    
    @classmethod
    def inward_material(cls, material_id, qty, plant_id, location_id, cost=0, **kwargs):
        """
        Inward material based on its type.
        
        For BULK: Uses BulkService.add_bulk()
        For ROLL: Should use GRNService.create_roll_grn() instead
        """
        material_type = cls.get_material_type(material_id)
        
        if material_type == 'BULK':
            return BulkService.add_bulk(
                material_id=material_id,
                qty=qty,
                plant_id=plant_id,
                location_id=location_id,
                cost=cost,
                reference=kwargs.get('reference', '')
            )
        else:
            raise ValidationError("Roll materials should use GRNService.create_roll_grn()")
