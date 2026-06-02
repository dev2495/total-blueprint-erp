"""
Phase 56: GRN Service (Refactored)

Unified GRN handling for both Bulk and Roll materials.
- Bulk GRN uses BulkService.add_bulk()
- Roll GRN creates InventoryRoll with physical specs + grade FK
"""

from django.db import transaction
from django.core.exceptions import ValidationError
from apps.inventory.models import InventoryRoll, InventoryLocation, RollMovement, Vendor
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService
from apps.materials.models import InventoryMaterial
from apps.materials.stock_forms import STOCK_FORM_OPEN_WEB, normalize_stock_form, normalize_width_basis
from typing import List, Dict, Any
from decimal import Decimal
import datetime
import random
import string


class GRNService:
    
    # Phase 13 Governance: GRN only into these location types
    ALLOWED_LOCATION_TYPES = ['WAREHOUSE', 'QC', 'RM', 'WIP']
    
    @classmethod
    def _validate_location(cls, location: InventoryLocation, plant):
        """Common location validation for GRN operations."""
        if location.plant != plant:
            raise ValidationError("Location does not belong to the specified plant.")
        
        if location.type not in cls.ALLOWED_LOCATION_TYPES:
            raise ValidationError(
                f"GRN allowed only in {cls.ALLOWED_LOCATION_TYPES} locations. Invalid type: {location.type}"
            )

    @classmethod
    def _validate_vendor(cls, vendor: Vendor):
        if not vendor:
            raise ValidationError("Vendor is required for GRN inward.")
        if str(vendor.status or "").upper() != "ACTIVE":
            raise ValidationError("Only active vendors can be used for GRN inward.")
        if str(vendor.type or "").upper() not in {"RM", "BOTH"}:
            raise ValidationError("GRN vendor must be RM or BOTH type.")
    
    @classmethod
    @transaction.atomic
    def create_bulk_grn(cls,
                        material: InventoryMaterial,
                        location: InventoryLocation,
                        vendor: Vendor,
                        quantity: float,
                        plant,
                        cost: float = 0,
                        reference: str = "",
                        granule_code_id: str | None = None,
                        granule_code: str | None = None,
                        vendor_invoice_no: str = "",
                        manual_po_ref: str = "",
                        allow_duplicate_vendor_invoice: bool = False,
                        # Compatibility aliases used by some tests/callers:
                        qty=None,
                        rate=None,
                        user=None):
        """
        Phase 56: Record a Bulk Goods Receipt.
        Uses BulkService.add_bulk() for proper inventory tracking.
        
        Args:
            material: InventoryMaterial (must be bulk category)
            location: InventoryLocation
            quantity: Quantity in KG
            plant: Plant instance
            cost: Cost per KG (for average cost calculation)
            reference: Reference number (invoice/challan)
            
        Returns:
            BulkTransaction record
        """
        if qty is not None and (quantity is None or quantity == 0):
            quantity = qty
        if rate is not None and (cost is None or cost == 0):
            cost = rate
        if quantity is None or Decimal(str(quantity)) <= 0:
            raise ValidationError("Quantity must be positive.")

        cls._validate_location(location, plant)
        cls._validate_vendor(vendor)

        # Vendor-invoice dedup (safety net; constraint is the source of truth).
        invoice_no = (vendor_invoice_no or "").strip()
        if vendor and invoice_no and not allow_duplicate_vendor_invoice:
            Vendor.objects.select_for_update().filter(id=vendor.id).first()
            from apps.inventory.models import BulkTransaction
            if BulkTransaction.objects.filter(
                vendor=vendor, vendor_invoice_no=invoice_no
            ).exists():
                raise ValidationError(
                    f"Duplicate vendor invoice '{invoice_no}' for vendor {vendor.code}."
                )
        
        # Validate material is a bulk type
        bulk_categories = ['GRANULE', 'INK', 'ADHESIVE', 'SOLVENT', 'POD', 'ADDON']
        if material.category not in bulk_categories:
            raise ValidationError(
                f"Bulk GRN requires bulk material type. Got: {material.category}"
            )

        material_code = str(material.code or '').upper()
        if material.category == 'ADHESIVE' and material_code != 'AD-ADHESIVE':
            raise ValidationError('Adhesive inward is locked to the AD-ADHESIVE system master.')
        if material.category == 'SOLVENT' and material_code != 'AD-SOLVENT':
            raise ValidationError('Solvent inward is locked to the AD-SOLVENT system master.')
        if material.category == 'ADDON':
            if not material.addon_is_purchased:
                raise ValidationError('Add-on inward is allowed only when the add-on master is marked purchased.')
            if str(material.base_uom or '').upper() not in {'KG', 'PCS', 'METER'}:
                raise ValidationError('Purchased add-on inward supports only KG, PCS, or METER inventory UOM.')

        resolved_granule_code_id = None
        if material.category == 'GRANULE':
            from apps.materials.models import GranuleQualityCode
            if granule_code_id:
                code_obj = GranuleQualityCode.objects.filter(id=granule_code_id, granule=material).first()
                if not code_obj:
                    raise ValidationError("Selected granule quality code does not belong to this granule.")
                resolved_granule_code_id = str(code_obj.id)
            elif granule_code:
                code_value = str(granule_code or "").strip().upper()
                if not code_value:
                    raise ValidationError("Granule quality code cannot be blank.")
                code_obj, _ = GranuleQualityCode.objects.get_or_create(
                    granule=material,
                    code=code_value,
                    defaults={"status": "ACTIVE"},
                )
                resolved_granule_code_id = str(code_obj.id)
        
        # Use BulkService for proper tracking
        return BulkService.add_bulk(
            material_id=str(material.id),
            qty=quantity,
            plant_id=str(plant.id),
            location_id=str(location.id),
            cost=cost,
            reference=f"VENDOR:{vendor.code} | {reference or 'GRN'}",
            granule_code_id=resolved_granule_code_id,
            vendor_id=str(vendor.id),
            vendor_invoice_no=invoice_no,
            manual_po_ref=(manual_po_ref or "").strip(),
            allow_duplicate_vendor_invoice=allow_duplicate_vendor_invoice,
        )

    @classmethod
    @transaction.atomic
    def create_roll_grn(cls,
                        material: InventoryMaterial,
                        location: InventoryLocation,
                        vendor: Vendor,
                        plant,
                        rolls_data: List[Dict[str, Any]],
                        reference: str = "",
                        vendor_invoice_no: str = "",
                        manual_po_ref: str = "",
                        allow_duplicate_vendor_invoice: bool = False) -> List[InventoryRoll]:
        """
        Phase 56: Record a Roll Goods Receipt (Multiple Rolls).
        Creates InventoryRoll objects with full physical specs.
        
        Each roll in rolls_data should contain:
        - label_id: Human readable barcode ID (required)
        - thickness_micron: Thickness in microns (required)
        - width_mm: Width in mm (required)
        - weight_kg: Weight in KG (required)
        - grade_id: UUID of RecipeGrade (optional, for extrusion tracking)
        - batch_no: Batch number (optional, auto-generated if not provided)
        - length_m: Length in meters (optional)
        
        Returns:
            List of created InventoryRoll objects
        """
        if not rolls_data:
            raise ValidationError("No rolls provided.")

        cls._validate_location(location, plant)
        cls._validate_vendor(vendor)

        invoice_no = (vendor_invoice_no or "").strip()
        if vendor and invoice_no and not allow_duplicate_vendor_invoice:
            Vendor.objects.select_for_update().filter(id=vendor.id).first()
            if InventoryRoll.objects.filter(
                vendor=vendor, vendor_invoice_no=invoice_no
            ).exists():
                raise ValidationError(
                    f"Duplicate vendor invoice '{invoice_no}' for vendor {vendor.code}."
                )
        
        # Validate material is a film variant (physical roll currency must always be a variant).
        if material.category != 'FILM_VARIANT':
            raise ValidationError(
                f"Roll GRN requires FILM_VARIANT material. Got: {material.category}"
            )

        created_rolls = []

        for data in rolls_data:
            # Validate required physical specs (Phase 56: specs on Roll)
            required_fields = ['thickness_micron', 'width_mm', 'weight_kg']
            for field in required_fields:
                if field not in data or data.get(field) is None:
                    raise ValidationError(f"Missing required field '{field}' for roll.")

            # Auto-generate batch if not provided
            batch_no = data.get('batch_no')
            
            # Grade is required only for extrudable variants.
            grade_id = data.get('grade_id')
            grade = None
            grade_required = bool(getattr(material, "is_extrudable", False))
            if grade_required and not grade_id:
                raise ValidationError("Grade is required for extrudable film variants.")
            if grade_required and grade_id:
                from apps.recipes.models import RecipeGrade
                try:
                    grade = RecipeGrade.objects.get(id=grade_id)
                except RecipeGrade.DoesNotExist:
                    raise ValidationError(f"Grade with ID {grade_id} not found.")
            stock_form = normalize_stock_form(data.get("stock_form") or STOCK_FORM_OPEN_WEB)
            width_basis = normalize_width_basis(data.get("width_basis"), stock_form=stock_form)

            # Phase 59: Use RollService for creation (strict compliance)
            roll = RollService.create_roll(
                material=material,
                weight_kg=Decimal(str(data['weight_kg'])),
                location=location,
                width_mm=Decimal(str(data['width_mm'])),
                thickness_micron=Decimal(str(data['thickness_micron'])),
                batch_no=batch_no,
                length_m=Decimal(str(data.get('length_m', 0))),
                grade=grade,
                is_fg=False,
                plant=plant,
                user=None, # System/Anonymous for now, or pass user
                notes=f"VENDOR:{vendor.code} | {reference or 'GRN'}",
                stock_form=stock_form,
                width_basis=width_basis,
            )
            
            # Label override if provided (RollService generates auto label)
            if data.get('label_id'):
                roll.label_id = data['label_id']
                roll.save(update_fields=['label_id'])

            meta = dict(roll.meta_json or {})
            meta.update({
                "grn_vendor_id": str(vendor.id),
                "grn_vendor_code": vendor.code,
                "grn_vendor_name": vendor.name,
                "grn_reference": reference or "",
                "grn_source": "GRN_INWARD",
                "grn_vendor_invoice_no": invoice_no,
                "stock_form": stock_form,
                "width_basis": width_basis,
            })
            unit_cost = data.get("unit_cost") or data.get("unit_cost_per_kg") or data.get("rate_per_kg") or data.get("rate_per_uom")
            if unit_cost not in (None, ""):
                meta["unit_cost_per_kg"] = str(unit_cost)
            roll.meta_json = meta
            roll.vendor = vendor
            roll.vendor_invoice_no = invoice_no
            roll.manual_po_ref = (manual_po_ref or "").strip()
            roll.save(update_fields=['meta_json', 'vendor', 'vendor_invoice_no', 'manual_po_ref'])

            created_rolls.append(roll)
            
            # InventoryLedger removed per Phase 59 Strict Rules
            # RollMovement is already created by RollService.create_roll

        return created_rolls
