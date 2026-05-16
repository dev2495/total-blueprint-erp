from django.db import models
import uuid

class Artwork(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PENDING_APPROVAL', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]
    SUBSTRATE_MODE_CHOICES = [
        ('SHEET', 'Sheet'),
        ('TUBING', 'Tubing'),
    ]
    INK_GSM_SPLIT_CHOICES = [
        ('EQUAL', 'Equal by color'),
        ('PERCENT', 'Percentage by color'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    design_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    print_type = models.CharField(max_length=20, default='FLEXO')
    substrate_mode = models.CharField(max_length=12, choices=SUBSTRATE_MODE_CHOICES, default='SHEET')
    product_master = models.ForeignKey(
        'materials.ProductMaster',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='artworks',
    )
    design_family_code = models.CharField(max_length=80, blank=True, default='')
    colorway_name = models.CharField(max_length=120, blank=True, default='')
    
    # Decoupled from Customer (Engineering Asset)
    # customer = models.ForeignKey(Customer, ...)  <-- REMOVED
    
    color_list = models.JSONField(default=list, help_text="List of hex codes or pantone names")
    color_mapping = models.JSONField(default=dict, help_text="Mapping of Template Color Name to Ink Material ID")
    ink_gsm_total = models.DecimalField(max_digits=8, decimal_places=4, default=0)
    ink_gsm_split_mode = models.CharField(max_length=12, choices=INK_GSM_SPLIT_CHOICES, default='EQUAL')
    ink_gsm_color_percentages = models.JSONField(default=dict, blank=True)
    ink_gsm_by_color = models.JSONField(default=dict, blank=True)
    cylinder_circumference_mm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cylinder_length_mm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    colors_count = models.IntegerField(default=0)
    front_colors_count = models.PositiveIntegerField(default=0)
    back_colors_count = models.PositiveIntegerField(default=0)
    front_colors = models.JSONField(default=list, help_text="Front side color names")
    back_colors = models.JSONField(default=list, help_text="Back side color names")
    
    file_path = models.CharField(max_length=500, blank=True, null=True, help_text="S3 or Local Path to PDF/AI")
    image = models.FileField(upload_to='artworks/', null=True, blank=True)
    version = models.IntegerField(default=1)
    previous_version = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="next_versions",
    )
    is_current_version = models.BooleanField(default=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    
    approved_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_artworks')
    approved_at = models.DateTimeField(null=True, blank=True)
    
    comments = models.TextField(blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.design_code} - {self.name} (v{self.version})"

    def save(self, *args, **kwargs):
        if str(self.substrate_mode or "SHEET").upper() == "SHEET":
            self.back_colors = []
            self.back_colors_count = 0
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'artwork_master'

    @property
    def total_side_colors(self):
        return int(self.front_colors_count or 0) + int(self.back_colors_count or 0)


class ArtworkImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    artwork = models.ForeignKey(Artwork, on_delete=models.CASCADE, related_name="images")
    image = models.FileField(upload_to="artworks/")
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "artwork_images"
        ordering = ["sort_order", "created_at"]

    def __str__(self):
        return f"{self.artwork_id} image {self.sort_order + 1}"
