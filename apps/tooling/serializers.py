from django.conf import settings
from rest_framework import serializers

from .models import Cylinder, CylinderSlotAssignment, ToolAsset


def _absolute_media_url(request, field_value) -> str | None:
    if not field_value:
        return None
    try:
        url = str(getattr(field_value, "url", field_value) or "").strip()
    except Exception:
        url = str(field_value or "").strip()
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if request is not None:
        return request.build_absolute_uri(url)
    fallback = str(getattr(settings, "PUBLIC_BACKEND_URL", "") or "").strip().rstrip("/")
    if fallback and url.startswith("/"):
        return f"{fallback}{url}"
    return url


class CylinderSerializer(serializers.ModelSerializer):
    artwork_name = serializers.CharField(source='artwork.name', read_only=True)
    artwork_image = serializers.SerializerMethodField()
    vendor_name = serializers.CharField(source='engraving_vendor.name', read_only=True)
    location_name = serializers.CharField(source='storage_location.name', read_only=True)

    class Meta:
        model = Cylinder
        fields = '__all__'

    def get_artwork_image(self, obj):
        return _absolute_media_url(self.context.get("request"), getattr(getattr(obj, "artwork", None), "image", None))

    def validate(self, attrs):
        instance = self.instance
        allowed_lifecycle_statuses = {"DRAFT", "READY", "ACTIVE", "MAINTENANCE", "RE_CHROME", "SCRAP"}

        def _value(key, default=None):
            if key in attrs:
                return attrs.get(key)
            return getattr(instance, key, default) if instance is not None else default

        is_draft = bool(_value("is_draft", True))
        lifecycle_status = str(_value("lifecycle_status", "DRAFT") or "DRAFT").upper()
        if lifecycle_status not in allowed_lifecycle_statuses:
            raise serializers.ValidationError(
                {
                    "lifecycle_status": (
                        f"Unsupported lifecycle_status '{lifecycle_status}'. "
                        f"Allowed: {', '.join(sorted(allowed_lifecycle_statuses))}."
                    )
                }
            )
        attrs["lifecycle_status"] = lifecycle_status

        if (not is_draft) or lifecycle_status != "DRAFT":
            missing = []
            code = str(_value("code", "") or "").strip()
            name = str(_value("name", "") or "").strip()
            color_name = str(_value("color_name", "") or "").strip()
            diameter = _value("diameter_mm", 0)
            width = _value("width_mm", 0)
            circumference = _value("circumference", 0)
            cell_depth = _value("cell_depth_microns", 0)
            engraving_vendor = _value("engraving_vendor", None)

            if not code:
                missing.append("code")
            if not name:
                missing.append("name")
            if not color_name:
                missing.append("color_name")
            if float(diameter or 0) <= 0:
                missing.append("diameter_mm")
            if float(width or 0) <= 0:
                missing.append("width_mm")
            if float(circumference or 0) <= 0:
                missing.append("circumference")
            if int(cell_depth or 0) <= 0:
                missing.append("cell_depth_microns")
            if not engraving_vendor:
                missing.append("engraving_vendor")

            if missing:
                raise serializers.ValidationError(
                    {"detail": f"Finalize cylinder requires: {', '.join(missing)}."}
                )

            attrs["is_draft"] = False
            if lifecycle_status == "DRAFT":
                attrs["lifecycle_status"] = "READY"

        artwork = _value("artwork", None)
        side = str(_value("side", "FRONT") or "FRONT").upper()
        side_slot_index = int(float(_value("side_slot_index", 0) or 0))
        if side not in {"FRONT", "BACK"}:
            raise serializers.ValidationError({"side": "Cylinder side must be FRONT or BACK."})
        if side_slot_index <= 0:
            raise serializers.ValidationError({"side_slot_index": "Cylinder side_slot_index must be greater than zero."})
        if artwork:
            max_slots = int(
                getattr(artwork, "front_colors_count", 0) if side == "FRONT" else getattr(artwork, "back_colors_count", 0)
            )
            if side_slot_index > max_slots:
                raise serializers.ValidationError(
                    {
                        "side_slot_index": (
                            f"Cylinder slot {side_slot_index} exceeds approved artwork {side.lower()} color slots ({max_slots})."
                        )
                    }
                )
        if artwork and side_slot_index > 0 and (not bool(attrs.get("is_draft", is_draft))):
            duplicate_qs = Cylinder.objects.filter(
                artwork=artwork,
                side=side,
                side_slot_index=side_slot_index,
                is_draft=False,
            )
            if instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=instance.pk)
            if duplicate_qs.exists():
                raise serializers.ValidationError(
                    {
                        "detail": (
                            f"Finalize cylinder blocked: artwork already has a finalized cylinder for {side}-{side_slot_index}."
                        )
                    }
                )
            assignment_qs = CylinderSlotAssignment.objects.filter(
                artwork=artwork,
                side=side,
                side_slot_index=side_slot_index,
                cylinder__is_draft=False,
            )
            if instance is not None:
                assignment_qs = assignment_qs.exclude(cylinder=instance)
            if assignment_qs.exists():
                raise serializers.ValidationError(
                    {
                        "detail": (
                            f"Finalize cylinder blocked: artwork slot {side}-{side_slot_index} is already assigned."
                        )
                    }
                )

        return attrs


class CylinderSlotAssignmentSerializer(serializers.ModelSerializer):
    artwork_name = serializers.CharField(source="artwork.name", read_only=True)
    artwork_design_code = serializers.CharField(source="artwork.design_code", read_only=True)
    cylinder_code = serializers.CharField(source="cylinder.code", read_only=True)
    cylinder_name = serializers.CharField(source="cylinder.name", read_only=True)
    cylinder_artwork_name = serializers.CharField(source="cylinder.artwork.name", read_only=True)
    cylinder_artwork_design_code = serializers.CharField(source="cylinder.artwork.design_code", read_only=True)
    cylinder_circumference = serializers.DecimalField(source="cylinder.circumference", read_only=True, max_digits=10, decimal_places=2)
    cylinder_width_mm = serializers.DecimalField(source="cylinder.width_mm", read_only=True, max_digits=10, decimal_places=2)
    cylinder_diameter_mm = serializers.DecimalField(source="cylinder.diameter_mm", read_only=True, max_digits=10, decimal_places=2)
    cylinder_cell_depth_microns = serializers.IntegerField(source="cylinder.cell_depth_microns", read_only=True)
    cylinder_lifecycle_status = serializers.CharField(source="cylinder.lifecycle_status", read_only=True)
    cylinder_is_draft = serializers.BooleanField(source="cylinder.is_draft", read_only=True)
    cylinder_status = serializers.CharField(source="cylinder.status", read_only=True)

    class Meta:
        model = CylinderSlotAssignment
        fields = "__all__"

    def validate(self, attrs):
        instance = self.instance
        artwork = attrs.get("artwork", getattr(instance, "artwork", None))
        cylinder = attrs.get("cylinder", getattr(instance, "cylinder", None))
        side = str(attrs.get("side", getattr(instance, "side", "FRONT")) or "FRONT").upper()
        slot = int(attrs.get("side_slot_index", getattr(instance, "side_slot_index", 0)) or 0)
        if side not in {"FRONT", "BACK"}:
            raise serializers.ValidationError({"side": "Slot side must be FRONT or BACK."})
        if slot <= 0:
            raise serializers.ValidationError({"side_slot_index": "Slot index must be greater than zero."})
        if artwork:
            max_slots = int(
                getattr(artwork, "front_colors_count", 0) if side == "FRONT" else getattr(artwork, "back_colors_count", 0)
            )
            if slot > max_slots:
                raise serializers.ValidationError(
                    {"side_slot_index": f"Slot {slot} exceeds artwork {side.lower()} color count ({max_slots})."}
                )
        if cylinder:
            if bool(getattr(cylinder, "is_draft", True)):
                raise serializers.ValidationError({"cylinder": "Only finalized cylinders can be reused for a slot."})
            if float(getattr(cylinder, "circumference", 0) or 0) <= 0:
                raise serializers.ValidationError({"cylinder": "Reusable cylinder must have circumference."})
        attrs["side"] = side
        if artwork and not str(attrs.get("color_name") or "").strip():
            colors = getattr(artwork, "front_colors", []) if side == "FRONT" else getattr(artwork, "back_colors", [])
            if isinstance(colors, list) and slot <= len(colors):
                attrs["color_name"] = str(colors[slot - 1] or "").strip().upper()
        else:
            attrs["color_name"] = str(attrs.get("color_name") or "").strip().upper()
        return attrs


class ToolAssetSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    location_name = serializers.CharField(source="storage_location.name", read_only=True)

    class Meta:
        model = ToolAsset
        fields = "__all__"

    def validate(self, attrs):
        instance = self.instance
        plant = attrs.get("plant", getattr(instance, "plant", None))
        storage_location = attrs.get("storage_location", getattr(instance, "storage_location", None))
        if storage_location:
            if plant and storage_location.plant_id != plant.id:
                raise serializers.ValidationError({"storage_location": "Storage location must belong to the same plant."})
            if str(storage_location.type or "").upper() != "TOOLING":
                raise serializers.ValidationError({"storage_location": "Storage location must be a TOOLING location."})
        return attrs
