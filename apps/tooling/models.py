from django.core.exceptions import ValidationError
from django.db import models
import uuid
from apps.artwork.models import Artwork
from apps.inventory.models import Vendor, InventoryLocation
from apps.factory.models import Plant

class Cylinder(models.Model):
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('MAINTENANCE', 'Maintenance'),
        ('RE_CHROME', 'Requires Re-chrome'),
        ('SCRAP', 'Scrapped'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    
    diameter_mm = models.DecimalField(max_digits=10, decimal_places=2)
    circumference = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Circumference in mm (Printing Repeat)")
    width_mm = models.DecimalField(max_digits=10, decimal_places=2)
    cell_depth_microns = models.IntegerField(default=0)
    
    # Linked to Artwork & Vendor
    artwork = models.ForeignKey(Artwork, on_delete=models.PROTECT, related_name='cylinders', null=True, blank=True)
    engraving_vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name='cylinders', null=True, blank=True)
    
    color_name = models.CharField(max_length=255, help_text="Specific color this cylinder prints", default="")
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    life_cycles_count = models.IntegerField(default=0, help_text="Number of times mounted/used")
    
    usage_count_linear_meters = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    last_serviced_at = models.DateTimeField(null=True, blank=True)
    
    storage_location = models.ForeignKey(InventoryLocation, on_delete=models.SET_NULL, null=True, blank=True, related_name='cylinders')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    side = models.CharField(max_length=10, default='FRONT')
    side_slot_index = models.PositiveIntegerField(default=1)
    is_draft = models.BooleanField(default=False)
    lifecycle_status = models.CharField(max_length=20, default='DRAFT')
    
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.code} - {self.name}"

    class Meta:
        db_table = 'tooling_cylinders'


class ToolAsset(models.Model):
    ASSET_TYPE_CHOICES = [
        ("ANILOX", "Anilox"),
        ("SLEEVE", "Sleeve"),
        ("CUTTING_DIE", "Cutting Die"),
        ("SEALING_JAW", "Sealing Jaw"),
        ("CORE_SHAFT", "Core Shaft"),
        ("MOUNTING_ADAPTER", "Mounting Adapter"),
        ("TOOLING_OTHER", "Other Tool"),
    ]
    STATUS_CHOICES = [
        ("READY", "Ready"),
        ("IN_USE", "In Use"),
        ("SERVICE_DUE", "Service Due"),
        ("MAINTENANCE", "Maintenance"),
        ("RETIRED", "Retired"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey(Plant, on_delete=models.PROTECT, related_name="tool_assets")
    asset_type = models.CharField(max_length=32, choices=ASSET_TYPE_CHOICES)
    code = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="READY")
    storage_location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tool_assets",
    )
    rack_code = models.CharField(max_length=50, blank=True, default="")
    slot_code = models.CharField(max_length=50, blank=True, default="")
    vendor = models.ForeignKey(Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name="tool_assets")
    service_due_at = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    meta_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tooling_assets"
        ordering = ["plant__name", "asset_type", "code"]

    def clean(self):
        if self.storage_location and self.storage_location.plant_id != self.plant_id:
            raise ValidationError({"storage_location": "Tool asset storage location must belong to the same plant."})
        if self.storage_location and str(self.storage_location.type or "").upper() != "TOOLING":
            raise ValidationError({"storage_location": "Tool assets must be stored in a TOOLING location."})

    def __str__(self):
        return f"{self.code} - {self.name}"
