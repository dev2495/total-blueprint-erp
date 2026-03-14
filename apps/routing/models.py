from django.db import models
import uuid

class RoutingRule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    
    # Strictly ordered list of Process Codes e.g. ["EXTRUSION", "PRINTING", "SLITTING"]
    ordered_processes = models.JSONField(default=list, help_text="Ordered list of Process codes")
    allowed_workcenters = models.JSONField(default=list, blank=True, help_text="Optional list of specific WC IDs")
    interplant_required = models.BooleanField(default=False)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_routing_rules'

    def __str__(self):
        return self.name
