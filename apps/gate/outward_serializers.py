import re

from rest_framework import serializers

from .image_pages import normalise_pages
from .qr import QR_KINDS
from .serializers import ActionInputSerializer

VEHICLE = re.compile(r"^[A-Z0-9]{4,15}$")


def normalise_vehicle_number(value):
    value = re.sub(r"[\s\-./]", "", str(value or "").upper())
    if value and not VEHICLE.match(value):
        raise serializers.ValidationError("Enter the vehicle number with letters and digits only, for example GJ15AB1234.")
    return value


class OutwardCaptureSerializer(ActionInputSerializer):
    plant = serializers.UUIDField()
    images = serializers.ListField(child=serializers.FileField(), min_length=1, max_length=6, write_only=True)
    vehicle_number = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    scanned_codes = serializers.ListField(child=serializers.CharField(max_length=512), required=False, max_length=10, default=list)

    def validate_images(self, images):
        return normalise_pages(images, noun="document page")

    def validate_vehicle_number(self, value):
        return normalise_vehicle_number(value)

    def validate_scanned_codes(self, codes):
        cleaned = []
        for code in codes:
            code = str(code or "").strip()
            if code and code not in cleaned:
                cleaned.append(code)
        return cleaned


class OutwardLinkSerializer(ActionInputSerializer):
    kind = serializers.ChoiceField(choices=sorted(QR_KINDS | {"OTHER"}))
    object_id = serializers.UUIDField(required=False)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)
    party_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, data):
        if data["kind"] == "OTHER":
            if not (data.get("reference") or "").strip():
                raise serializers.ValidationError({"reference": "Type the reference printed on the paper (e.g. supplier return note number)."})
            if len((data.get("reason") or "").strip()) < 5:
                raise serializers.ValidationError({"reason": "Say in a few words what this paper is."})
            data.pop("object_id", None)
        elif not data.get("object_id"):
            raise serializers.ValidationError({"object_id": "Choose the ERP document."})
        return data


class OutwardUnlinkSerializer(ActionInputSerializer):
    link_id = serializers.UUIDField()
    reason = serializers.CharField(min_length=5, max_length=500)


class OutwardDiscrepancySerializer(ActionInputSerializer):
    notes = serializers.CharField(min_length=5, max_length=500)


class OutwardResolveSerializer(ActionInputSerializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)


class OutwardVoidSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)
