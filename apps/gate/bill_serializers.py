import hashlib
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers
from .serializers import ActionInputSerializer


class BillUploadSerializer(ActionInputSerializer):
    plant = serializers.UUIDField()
    images = serializers.ListField(child=serializers.FileField(), min_length=1, max_length=6, write_only=True)

    def validate_images(self, images):
        pages = []
        for uploaded in images:
            if uploaded.size > 10*1024*1024:
                raise serializers.ValidationError("Each bill image must be 10 MiB or smaller.")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    image = Image.open(uploaded)
                    if image.format not in {"JPEG", "PNG", "WEBP"} or image.width*image.height > 40_000_000 or min(image.size) < 320:
                        raise ValueError()
                    image.load()
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
                    for quality in [92, 88, 84]:
                        output = io.BytesIO()
                        image.save(output, format="JPEG", quality=quality, optimize=True)
                        data = output.getvalue()
                        if len(data) <= 2*1024*1024:
                            break
                    else:
                        raise ValueError()
                    pages.append({"data": data, "width": image.width, "height": image.height, "byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
                raise serializers.ValidationError("Use a clear JPEG, PNG or WebP bill image, 320 px or larger, up to 40 million pixels. Convert HEIC/PDF to JPEG first.")
        return pages


class BillReviewSerializer(ActionInputSerializer):
    vendor_id = serializers.UUIDField(required=False)
    invoice_number = serializers.CharField(max_length=80, required=False, allow_blank=True)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    vehicle_number = serializers.CharField(max_length=40, required=False, allow_blank=True)
    purchase_order_id = serializers.UUIDField(required=False)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, data):
        if len(data) == 1:
            raise serializers.ValidationError("Choose a review field to save.")
        return data


class ReceiptRefSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["BULK", "ROLL", "PACKAGING", "PO_RECEIPT", "TRADING"])
    id = serializers.UUIDField()


class BillFinishSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)


class BillLinkSerializer(BillFinishSerializer):
    receipt_refs = ReceiptRefSerializer(many=True, min_length=1, max_length=100)
    bill_complete = serializers.BooleanField(default=False)


class BillVoidSerializer(BillFinishSerializer):
    resolution_code = serializers.ChoiceField(choices=["DUPLICATE", "NON_STOCK", "UNREADABLE", "CANCELLED"])
    duplicate_of = serializers.UUIDField(required=False)

    def validate(self, data):
        if (data["resolution_code"] == "DUPLICATE") != bool(data.get("duplicate_of")):
            raise serializers.ValidationError("Duplicate resolution requires another same-plant bill; other resolutions cannot specify duplicate_of.")
        return data
