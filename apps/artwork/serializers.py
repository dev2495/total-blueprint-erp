import json
from decimal import Decimal, InvalidOperation
from typing import Any, List

from django.conf import settings
from rest_framework import serializers

from apps.inventory.models import InkMaterial

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


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
        value = parsed
    if not isinstance(value, dict):
        return {}
    out: dict[str, Any] = {}
    for key, mapped in value.items():
        color = str(key or "").strip().upper()
        if not color:
            continue
        if isinstance(mapped, dict):
            nested: dict[str, str] = {}
            for base in ("POLY", "PET"):
                ink_id = str(mapped.get(base) or mapped.get(base.lower()) or "").strip()
                if ink_id:
                    nested[base] = ink_id
            if nested:
                out[color] = nested
            continue
        ink_id = str(mapped or "").strip()
        if ink_id:
            out[color] = ink_id
    return out


def _validate_ink_mapping(mapping: dict[str, Any]) -> None:
    for color, mapped in mapping.items():
        values: list[tuple[str | None, str]] = []
        if isinstance(mapped, dict):
            values = [(str(base).upper(), str(ink_id).strip()) for base, ink_id in mapped.items() if str(ink_id).strip()]
        else:
            values = [(None, str(mapped).strip())]
        for base, ink_id in values:
            ink = InkMaterial.objects.filter(id=ink_id).first()
            if not ink:
                raise serializers.ValidationError({"color_mapping": f"{color}: selected ink does not exist in inventory ink master."})
            if base in {"POLY", "PET"} and str(ink.base_type or "").upper() != base:
                raise serializers.ValidationError({"color_mapping": f"{color}: {base} mapping must point to a {base} ink."})


def _coerce_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise serializers.ValidationError("GSM values must be numeric.")
    if not parsed.is_finite():
        raise serializers.ValidationError("GSM values must be finite.")
    return parsed


def _coerce_decimal_mapping(value: Any, *, field_name: str) -> dict[str, Decimal]:
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return {}
        try:
            value = json.loads(raw)
        except Exception as exc:
            raise serializers.ValidationError({field_name: "Must be a JSON object."}) from exc
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise serializers.ValidationError({field_name: "Must be an object keyed by color."})
    out: dict[str, Decimal] = {}
    for key, raw_num in value.items():
        color = str(key or "").strip().upper()
        if not color:
            continue
        num = _coerce_decimal(raw_num)
        if num < 0:
            raise serializers.ValidationError({field_name: f"{color}: value cannot be negative."})
        out[color] = num
    return out


def _json_number(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.0001")).normalize())


def _normalize_ink_gsm_contract(
    *,
    total_value: Any,
    split_mode_value: Any,
    percentages_value: Any,
    color_names: list[str],
) -> dict[str, Any]:
    total = _coerce_decimal(total_value)
    if total < 0:
        raise serializers.ValidationError({"ink_gsm_total": "Total ink GSM cannot be negative."})
    split_mode = str(split_mode_value or "EQUAL").strip().upper()
    if split_mode not in {"EQUAL", "PERCENT"}:
        raise serializers.ValidationError({"ink_gsm_split_mode": "Use EQUAL or PERCENT."})

    colors = list(dict.fromkeys([str(color or "").strip().upper() for color in color_names if str(color or "").strip()]))
    if not colors or total <= 0:
        return {
            "ink_gsm_total": total,
            "ink_gsm_split_mode": split_mode,
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {},
        }

    if split_mode == "EQUAL":
        per_color = total / Decimal(str(len(colors)))
        return {
            "ink_gsm_total": total,
            "ink_gsm_split_mode": split_mode,
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {color: _json_number(per_color) for color in colors},
        }

    percentages = _coerce_decimal_mapping(percentages_value, field_name="ink_gsm_color_percentages")
    missing = [color for color in colors if color not in percentages]
    if missing:
        raise serializers.ValidationError(
            {"ink_gsm_color_percentages": f"Missing percentage for colors: {', '.join(missing)}."}
        )
    pruned = {color: percentages[color] for color in colors}
    total_pct = sum(pruned.values(), Decimal("0"))
    if abs(total_pct - Decimal("100")) > Decimal("0.01"):
        raise serializers.ValidationError({"ink_gsm_color_percentages": "Color percentages must total 100."})
    return {
        "ink_gsm_total": total,
        "ink_gsm_split_mode": split_mode,
        "ink_gsm_color_percentages": {color: _json_number(value) for color, value in pruned.items()},
        "ink_gsm_by_color": {
            color: _json_number(total * pct / Decimal("100")) for color, pct in pruned.items()
        },
    }


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
    product_master_name = serializers.CharField(source="product_master.name", read_only=True, allow_null=True)
    product_master_code = serializers.CharField(source="product_master.code", read_only=True, allow_null=True)

    class Meta:
        model = Artwork
        fields = "__all__"
        read_only_fields = ("approved_by", "approved_at", "product_master_name", "product_master_code")

    def _next_version_code(self, instance: Artwork) -> str:
        raw_code = str(instance.design_code or "ART").strip().upper()
        base = raw_code.rsplit("-V", 1)[0] if "-V" in raw_code else raw_code
        next_version = int(instance.version or 1) + 1
        code = f"{base}-V{next_version}"
        while Artwork.objects.filter(design_code=code).exclude(id=instance.id).exists():
            next_version += 1
            code = f"{base}-V{next_version}"
        return code

    def _copy_existing_images(self, source: Artwork, target: Artwork):
        for index, image_row in enumerate(source.images.order_by("sort_order", "created_at")[:3]):
            if image_row.image:
                ArtworkImage.objects.create(artwork=target, image=image_row.image.name, sort_order=index)
        if target.images.exists():
            first = target.images.order_by("sort_order", "created_at").first()
            if first:
                target.image = first.image.name
                target.save(update_fields=["image"])
        elif getattr(source, "image", None):
            target.image = source.image.name
            target.save(update_fields=["image"])

    def _requires_new_version(self, instance: Artwork) -> bool:
        if str(instance.status or "").upper() == "APPROVED":
            return True
        if instance.cylinders.filter(is_draft=False).exists():
            return True
        if instance.cylinder_slot_assignments.filter(cylinder__is_draft=False).exists():
            return True
        if getattr(instance, "sales_order_items_assigned", None) is not None and instance.sales_order_items_assigned.exists():
            return True
        if getattr(instance, "planned_stock_orders_assigned", None) is not None and instance.planned_stock_orders_assigned.exists():
            return True
        return False

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
        request = self.context.get("request")
        update_in_place = False
        if request is not None:
            update_in_place = str(request.data.get("update_in_place", "")).strip().lower() in {"1", "true", "yes"}
        if not update_in_place and self._requires_new_version(instance):
            version_data = {
                "design_code": self._next_version_code(instance),
                "name": instance.name,
                "print_type": instance.print_type,
                "substrate_mode": instance.substrate_mode,
                "color_list": list(instance.color_list or []),
                "color_mapping": dict(instance.color_mapping or {}),
                "colors_count": instance.colors_count,
                "front_colors_count": instance.front_colors_count,
                "back_colors_count": instance.back_colors_count,
                "front_colors": list(instance.front_colors or []),
                "back_colors": list(instance.back_colors or []),
                "ink_gsm_total": instance.ink_gsm_total,
                "ink_gsm_split_mode": instance.ink_gsm_split_mode,
                "ink_gsm_color_percentages": dict(instance.ink_gsm_color_percentages or {}),
                "ink_gsm_by_color": dict(instance.ink_gsm_by_color or {}),
                "file_path": instance.file_path,
                "image": instance.image,
                "version": int(instance.version or 1) + 1,
                "previous_version": instance,
                "is_current_version": True,
                "status": "DRAFT",
                "comments": instance.comments,
            }
            version_data.update(validated_data)
            requested_code = str(validated_data.get("design_code") or "").strip()
            if requested_code and requested_code.upper() != str(instance.design_code or "").strip().upper():
                version_data["design_code"] = requested_code
            else:
                version_data["design_code"] = self._next_version_code(instance)
            instance.is_current_version = False
            instance.save(update_fields=["is_current_version"])
            artwork = Artwork.objects.create(**version_data)
            if self._incoming_images():
                return self._sync_images(artwork)
            self._copy_existing_images(instance, artwork)
            return artwork
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

        incoming_mapping = attrs.get(
            "color_mapping",
            self.initial_data.get("color_mapping") if isinstance(self.initial_data, dict) else None,
        )
        color_mapping = _coerce_mapping(incoming_mapping)
        if not color_mapping and self.instance is not None:
            color_mapping = _coerce_mapping(getattr(self.instance, "color_mapping", {}) or {})
        if color_mapping:
            allowed_colors = set(color_list)
            color_mapping = {color: value for color, value in color_mapping.items() if color in allowed_colors}
            _validate_ink_mapping(color_mapping)

        ink_total = attrs.get("ink_gsm_total", getattr(self.instance, "ink_gsm_total", 0) if self.instance else 0)
        ink_split_mode = attrs.get(
            "ink_gsm_split_mode",
            getattr(self.instance, "ink_gsm_split_mode", "EQUAL") if self.instance else "EQUAL",
        )
        if isinstance(self.initial_data, dict) and "ink_gsm_color_percentages" in self.initial_data:
            raw_percentages = self.initial_data.get("ink_gsm_color_percentages")
        else:
            raw_percentages = attrs.get(
                "ink_gsm_color_percentages",
                getattr(self.instance, "ink_gsm_color_percentages", {}) if self.instance else {},
            )
        ink_contract = _normalize_ink_gsm_contract(
            total_value=ink_total,
            split_mode_value=ink_split_mode,
            percentages_value=raw_percentages,
            color_names=color_list,
        )

        attrs["print_type"] = str(attrs.get("print_type") or getattr(self.instance, "print_type", "FLEXO")).upper()
        attrs["substrate_mode"] = substrate_mode
        attrs["front_colors"] = [str(v).strip().upper() for v in front_colors]
        attrs["back_colors"] = [str(v).strip().upper() for v in back_colors]
        attrs["front_colors_count"] = front_count
        attrs["back_colors_count"] = back_count
        attrs["color_list"] = color_list
        attrs["colors_count"] = front_count + back_count if (front_count + back_count) > 0 else len(color_list)
        attrs["color_mapping"] = color_mapping
        attrs["ink_gsm_total"] = ink_contract["ink_gsm_total"]
        attrs["ink_gsm_split_mode"] = ink_contract["ink_gsm_split_mode"]
        attrs["ink_gsm_color_percentages"] = ink_contract["ink_gsm_color_percentages"]
        attrs["ink_gsm_by_color"] = ink_contract["ink_gsm_by_color"]
        return attrs
