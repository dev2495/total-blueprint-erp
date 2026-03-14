import json
from typing import Any, Dict, List

from rest_framework import serializers

from .models import Artwork


def _coerce_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(v).strip() for v in parsed if str(v).strip()]
        except Exception:
            pass
        return [chunk.strip() for chunk in raw.split(",") if chunk.strip()]
    return []


class ArtworkSerializer(serializers.ModelSerializer):
    total_side_colors = serializers.IntegerField(read_only=True)
    cylinder_ready = serializers.SerializerMethodField()

    class Meta:
        model = Artwork
        fields = "__all__"
        read_only_fields = ("approved_by", "approved_at")

    def get_cylinder_ready(self, obj):
        front_required = int(obj.front_colors_count or 0)
        back_required = int(obj.back_colors_count or 0)
        if front_required + back_required <= 0:
            return False
        front_slots = set(
            obj.cylinders.filter(side="FRONT", is_draft=False).values_list("side_slot_index", flat=True)
        )
        back_slots = set(
            obj.cylinders.filter(side="BACK", is_draft=False).values_list("side_slot_index", flat=True)
        )
        return len(front_slots) >= front_required and len(back_slots) >= back_required

    def validate(self, attrs):
        if "approved_by" in self.initial_data or "approved_at" in self.initial_data:
            raise serializers.ValidationError(
                "approved_by and approved_at are managed only by the approve action."
            )

        incoming_status = attrs.get("status")
        if str(incoming_status or "").strip().upper() == "APPROVED":
            raise serializers.ValidationError(
                {"status": "APPROVED status is managed only by the approve action."}
            )

        front_colors = _coerce_list(attrs.get("front_colors", self.instance.front_colors if self.instance else []))
        back_colors = _coerce_list(attrs.get("back_colors", self.instance.back_colors if self.instance else []))
        color_list = _coerce_list(attrs.get("color_list", self.instance.color_list if self.instance else []))

        front_count = attrs.get("front_colors_count", self.instance.front_colors_count if self.instance else 0)
        back_count = attrs.get("back_colors_count", self.instance.back_colors_count if self.instance else 0)
        front_count = int(front_count or 0)
        back_count = int(back_count or 0)
        if front_count < 0 or back_count < 0:
            raise serializers.ValidationError("Front/back color counts cannot be negative.")

        if front_colors and front_count == 0:
            front_count = len(front_colors)
        if back_colors and back_count == 0:
            back_count = len(back_colors)
        if front_count and front_colors and len(front_colors) != front_count:
            raise serializers.ValidationError("front_colors_count must match number of front_colors.")
        if back_count and back_colors and len(back_colors) != back_count:
            raise serializers.ValidationError("back_colors_count must match number of back_colors.")

        merged_colors = [str(v).strip().upper() for v in (front_colors + back_colors) if str(v).strip()]
        if merged_colors:
            color_list = merged_colors
        else:
            color_list = [str(v).strip().upper() for v in color_list if str(v).strip()]

        attrs["print_type"] = str(attrs.get("print_type") or getattr(self.instance, "print_type", "FLEXO")).upper()
        attrs["front_colors"] = [str(v).strip().upper() for v in front_colors]
        attrs["back_colors"] = [str(v).strip().upper() for v in back_colors]
        attrs["front_colors_count"] = front_count
        attrs["back_colors_count"] = back_count
        attrs["color_list"] = color_list
        attrs["colors_count"] = front_count + back_count if (front_count + back_count) > 0 else len(color_list)
        # V2: artwork stores side-color identity only; PET/POLY ink SKU mapping
        # is derived later from stack density + ink master.
        attrs["color_mapping"] = {}
        return attrs
