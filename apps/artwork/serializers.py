import json
from typing import Any, List

from django.conf import settings
from rest_framework import serializers

from .models import Artwork, ArtworkImage


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


class AbsoluteMediaFileField(serializers.FileField):
    def to_representation(self, value):
        return _absolute_media_url(self.context.get("request"), value)


class ArtworkImageSerializer(serializers.ModelSerializer):
    image = AbsoluteMediaFileField(read_only=True)

    class Meta:
        model = ArtworkImage
        fields = ("id", "image", "sort_order", "created_at")


class ArtworkSerializer(serializers.ModelSerializer):

    image = AbsoluteMediaFileField(required=False, allow_null=True)
    images = ArtworkImageSerializer(many=True, read_only=True)
    primary_image = serializers.SerializerMethodField()
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
        assignments = getattr(obj, "cylinder_slot_assignments", None)
        if assignments is not None:
            front_assigned = set(
                assignments.filter(side="FRONT", cylinder__is_draft=False).values_list("side_slot_index", flat=True)
            )
            back_assigned = set(
                assignments.filter(side="BACK", cylinder__is_draft=False).values_list("side_slot_index", flat=True)
            )
            if len(front_assigned) >= front_required and len(back_assigned) >= back_required:
                return True
        front_slots = set(
            obj.cylinders.filter(side="FRONT", is_draft=False).values_list("side_slot_index", flat=True)
        )
        back_slots = set(
            obj.cylinders.filter(side="BACK", is_draft=False).values_list("side_slot_index", flat=True)
        )
        return len(front_slots) >= front_required and len(back_slots) >= back_required

    def get_primary_image(self, obj):
        first_image = None
        try:
            first_image = obj.images.all()[0]
        except Exception:
            first_image = None
        if first_image is not None:
            return _absolute_media_url(self.context.get("request"), first_image.image)
        return _absolute_media_url(self.context.get("request"), getattr(obj, "image", None))

    def _incoming_images(self):
        request = self.context.get("request")
        if request is None or not hasattr(request, "FILES"):
            return []
        files = []
        for key in ("images", "images[]", "artwork_images"):
            files.extend(request.FILES.getlist(key))
        if not files and request.FILES.get("image"):
            files.append(request.FILES.get("image"))
        return [file for file in files if file]

    def _sync_images(self, artwork):
        files = self._incoming_images()
        if not files:
            if getattr(artwork, "image", None) and not artwork.images.exists():
                ArtworkImage.objects.create(artwork=artwork, image=artwork.image.name, sort_order=0)
            return artwork
        if len(files) > 3:
            raise serializers.ValidationError({"images": "Upload a maximum of 3 artwork images."})
        artwork.images.all().delete()
        for index, file in enumerate(files):
            ArtworkImage.objects.create(artwork=artwork, image=file, sort_order=index)
        first = artwork.images.order_by("sort_order", "created_at").first()
        if first:
            artwork.image = first.image.name
            artwork.save(update_fields=["image"])
        return artwork

    def create(self, validated_data):
        artwork = super().create(validated_data)
        return self._sync_images(artwork)

    def update(self, instance, validated_data):
        artwork = super().update(instance, validated_data)
        return self._sync_images(artwork)

    def validate(self, attrs):
        if "approved_by" in self.initial_data or "approved_at" in self.initial_data:
            raise serializers.ValidationError(
                "approved_by and approved_at are managed only by the approve action."
            )
        if len(self._incoming_images()) > 3:
            raise serializers.ValidationError({"images": "Upload a maximum of 3 artwork images."})

        incoming_status = attrs.get("status")
        if str(incoming_status or "").strip().upper() == "APPROVED":
            raise serializers.ValidationError(
                {"status": "APPROVED status is managed only by the approve action."}
            )

        substrate_mode = str(
            attrs.get(
                "substrate_mode",
                self.initial_data.get("film_type") if isinstance(self.initial_data, dict) else None,
            )
            or getattr(self.instance, "substrate_mode", "SHEET")
            or "SHEET"
        ).strip().upper()
        if substrate_mode not in {"SHEET", "TUBING"}:
            raise serializers.ValidationError({"substrate_mode": "Film type must be SHEET or TUBING."})

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
        if substrate_mode == "SHEET":
            back_colors = []
            back_count = 0
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
        attrs["substrate_mode"] = substrate_mode
        attrs["front_colors"] = [str(v).strip().upper() for v in front_colors]
        attrs["back_colors"] = [str(v).strip().upper() for v in back_colors]
        attrs["front_colors_count"] = front_count
        attrs["back_colors_count"] = back_count
        attrs["color_list"] = color_list
        attrs["colors_count"] = front_count + back_count if (front_count + back_count) > 0 else len(color_list)
        attrs["color_mapping"] = {}
        return attrs
