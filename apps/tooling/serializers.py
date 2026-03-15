from rest_framework import serializers

from .models import Cylinder, ToolAsset

class CylinderSerializer(serializers.ModelSerializer):
    artwork_name = serializers.CharField(source='artwork.name', read_only=True)
    artwork_image = serializers.ImageField(source='artwork.image', read_only=True)
    vendor_name = serializers.CharField(source='engraving_vendor.name', read_only=True)
    location_name = serializers.CharField(source='storage_location.name', read_only=True)
    
    class Meta:
        model = Cylinder
        fields = '__all__'

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

        # Any non-draft lifecycle requires full technical details.
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
