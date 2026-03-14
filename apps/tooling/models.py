from django.db import models
import uuid
from apps.artwork.models import Artwork
from apps.inventory.models import Vendor, InventoryLocation

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
