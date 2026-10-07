import io
import re
import warnings
from decimal import Decimal
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

PURPOSES = ["Meeting", "Delivery", "Collection", "Service / maintenance", "Interview", "Official visit", "Other"]


class LineInputSerializer(serializers.Serializer):
    product_kind = serializers.ChoiceField(choices=["MATERIAL", "PRODUCT", "TRADING", "CONSUMABLE"])
    product_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=16, decimal_places=4, min_value=Decimal("0.0001"))
    uom = serializers.CharField(max_length=10)
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False, allow_null=True)


class GoodsInputSerializer(serializers.Serializer):
    client_token = serializers.UUIDField()
    plant = serializers.UUIDField()
    direction = serializers.ChoiceField(choices=["INWARD", "OUTWARD"])
    invoice_number = serializers.CharField(max_length=80)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    vehicle_number = serializers.CharField(max_length=40)
    party_kind = serializers.ChoiceField(choices=["VENDOR", "CUSTOMER"])
    party_id = serializers.UUIDField()
    lines = LineInputSerializer(many=True, required=False, max_length=50, allow_empty=False)
    document_kind = serializers.ChoiceField(choices=["GRN", "TRADING_RECEIPT", "DISPATCH", "CHALLAN", "TRADE"], required=False)
    document_id = serializers.UUIDField(required=False)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, attrs):
        if bool(attrs.get("document_kind")) != bool(attrs.get("document_id")):
            raise serializers.ValidationError("Choose both document kind and reference.")
        if not attrs.get("lines") and not attrs.get("document_id"):
            raise serializers.ValidationError({"lines": "Choose at least one product and its observed quantity."})
        return attrs


class VisitorInputSerializer(serializers.Serializer):
    client_token = serializers.UUIDField()
    gate_token = serializers.UUIDField(required=False)
    plant = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=120)
    mobile = serializers.CharField(max_length=30)
    purpose = serializers.ChoiceField(choices=PURPOSES)
    company = serializers.CharField(max_length=160, required=False, allow_blank=True)
    government_id_type = serializers.ChoiceField(choices=["AADHAAR", "PAN", "OTHER"], required=False, allow_blank=True)
    government_id_number = serializers.CharField(max_length=40, required=False, allow_blank=True, write_only=True)
    selfie = serializers.FileField(required=False, write_only=True)
    consent = serializers.BooleanField()

    def validate_mobile(self, value):
        value = re.sub(r"[\s()-]", "", value)
        if value.startswith("+91") and len(value) == 13:
            value = value[3:]
        elif value.startswith("91") and len(value) == 12:
            value = value[2:]
        if not re.fullmatch(r"[6-9][0-9]{9}", value):
            raise serializers.ValidationError("Enter a valid 10-digit Indian mobile number.")
        return value

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError("Please consent to recording this factory visit.")
        return value

    def validate_selfie(self, uploaded):
        if uploaded.size > 3 * 1024 * 1024:
            raise serializers.ValidationError("Selfie must be 3 MB or smaller.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                photo = Image.open(uploaded)
                if photo.format not in {"JPEG", "PNG", "WEBP"} or photo.width * photo.height > 12_000_000:
                    raise ValueError()
                photo.load()
                photo = ImageOps.exif_transpose(photo).convert("RGB")
                photo.thumbnail((640, 640))
                result = io.BytesIO()
                photo.save(result, format="JPEG", quality=80, optimize=True)
                value = result.getvalue()
                if len(value) > 300_000:
                    raise ValueError()
                return value
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise serializers.ValidationError("Use a clear JPEG, PNG or WebP selfie.")

    def validate(self, attrs):
        number = str(attrs.get("government_id_number", "")).strip().upper()
        kind = attrs.get("government_id_type", "")
        if number:
            if not kind:
                raise serializers.ValidationError({"government_id_type": "Choose the optional ID type."})
            if kind == "AADHAAR":
                number = re.sub(r"[\s-]", "", number)
                if not re.fullmatch(r"[2-9][0-9]{11}", number):
                    raise serializers.ValidationError({"government_id_number": "Enter a valid 12-digit Aadhaar number."})
            elif kind == "PAN" and not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", number):
                raise serializers.ValidationError({"government_id_number": "Enter a valid PAN number."})
            elif kind == "OTHER" and not re.fullmatch(r"[A-Z0-9 -]{4,40}", number):
                raise serializers.ValidationError({"government_id_number": "Use 4-40 letters or numbers."})
        elif kind:
            raise serializers.ValidationError({"government_id_number": "Enter the ID number or leave ID type empty."})
        attrs["government_id_number"] = number
        return attrs


class ActionInputSerializer(serializers.Serializer):
    client_token = serializers.UUIDField()


class CancelInputSerializer(ActionInputSerializer):
    reason = serializers.ChoiceField(choices=["Visitor left", "Duplicate / mistaken registration", "Entry declined", "Visit cancelled"])


class ReconcileInputSerializer(ActionInputSerializer):
    reason = serializers.CharField(max_length=500, min_length=5)
    document_kind = serializers.ChoiceField(choices=["GRN", "TRADING_RECEIPT", "DISPATCH", "CHALLAN", "TRADE"])
    document_id = serializers.UUIDField()


class CorrectionInputSerializer(ActionInputSerializer):
    reason = serializers.CharField(max_length=500, min_length=5)
    vehicle_number = serializers.CharField(max_length=40, required=False)
    invoice_number = serializers.CharField(max_length=80, required=False)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    lines = LineInputSerializer(many=True, required=False, max_length=50, allow_empty=False)

    def validate(self, attrs):
        if not set(attrs).difference({"client_token", "reason"}):
            raise serializers.ValidationError("Choose a correction to record.")
        return attrs
