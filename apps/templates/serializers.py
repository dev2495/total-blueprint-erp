from rest_framework import serializers

from .models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)


class TemplateSummarySerializer(serializers.ModelSerializer):
    routing_rule_name = serializers.ReadOnlyField(source="routing_rule.name")
    created_by_name = serializers.ReadOnlyField(source="created_by.username")
    commercial_family_name = serializers.ReadOnlyField(source="commercial_family.name")
    readiness = serializers.SerializerMethodField()

    def get_readiness(self, obj):
        request = self.context.get("request")
        if request:
            lightweight = str(
                request.query_params.get("options")
                or request.query_params.get("light")
                or ""
            ).strip().lower()
            if lightweight in {"1", "true", "yes"}:
                return None

        from .services import TemplateGovernanceService

        return TemplateGovernanceService.readiness(obj)

    class Meta:
        model = TemplateBlueprint
        fields = [
            "id",
            "name",
            "fg_type",
            "pouch_style",
            "commercial_family",
            "commercial_family_name",
            "default_stock_strategy",
            "status",
            "version",
            "routing_rule",
            "routing_rule_name",
            "created_by_name",
            "created_at",
            "readiness",
        ]


class TemplateBlueprintSerializer(serializers.ModelSerializer):
    routing_rule_name = serializers.ReadOnlyField(source="routing_rule.name")
    created_by_name = serializers.ReadOnlyField(source="created_by.username")
    approved_by_name = serializers.ReadOnlyField(source="approved_by.username")
    commercial_family_name = serializers.ReadOnlyField(source="commercial_family.name")
    readiness = serializers.SerializerMethodField()

    def get_readiness(self, obj):
        from .services import TemplateGovernanceService

        return TemplateGovernanceService.readiness(obj)

    class Meta:
        model = TemplateBlueprint
        fields = [
            "id",
            "name",
            "fg_type",
            "pouch_style",
            "commercial_family",
            "commercial_family_name",
            "default_stock_strategy",
            "status",
            "routing_rule",
            "routing_rule_name",
            "version",
            "created_by",
            "created_by_name",
            "approved_by",
            "approved_by_name",
            "approved_at",
            "created_at",
            "updated_at",
            "readiness",
        ]
        read_only_fields = ["id", "version", "created_at", "updated_at", "approved_at", "approved_by"]


class TemplateProcessStepMaterialSerializer(serializers.ModelSerializer):
    material_name = serializers.SerializerMethodField()
    material_code = serializers.SerializerMethodField()
    material_category = serializers.SerializerMethodField()

    def get_material_name(self, obj):
        return f"{str(obj.category_code or '').upper()} (Category)"

    def get_material_code(self, obj):
        return None

    def get_material_category(self, obj):
        return str(obj.category_code or "").upper() or None

    class Meta:
        model = TemplateProcessStepMaterial
        fields = [
            "id",
            "template_step",
            "source_kind",
            "category_code",
            "material_name",
            "material_code",
            "material_category",
            "consumption_basis",
            "formula_driver",
            "formula_params",
            "issue_policy_mode",
            "issue_policy_value",
            "capture_mode",
            "quantity_mode",
            "value",
            "is_optional",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "consumption_basis": {"required": False, "allow_null": True},
            "formula_driver": {"required": False, "allow_null": True},
            "formula_params": {"required": False, "allow_null": True},
            "issue_policy_mode": {"required": False, "allow_null": True},
            "issue_policy_value": {"required": False, "allow_null": True},
            "capture_mode": {"required": False, "allow_null": True},
            "quantity_mode": {"required": False, "allow_null": True},
            "value": {"required": False, "allow_null": True},
            "is_optional": {"required": False, "allow_null": True},
        }

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        attrs["source_kind"] = "CATEGORY"
        attrs["material"] = None
        category_code = str(
            attrs.get("category_code")
            or getattr(instance, "category_code", "")
            or ""
        ).strip().upper()
        if not category_code:
            raise serializers.ValidationError({"category_code": "category_code is required."})
        attrs["category_code"] = category_code
        ink_legacy = category_code in {"INK", "INKS"}
        if ink_legacy and instance is None:
            raise serializers.ValidationError({
                "category_code": "INK mappings are no longer allowed on templates. Use artwork GSM theory plus floor stock reconciliation."
            })
        if not attrs.get("consumption_basis"):
            if instance and getattr(instance, "consumption_basis", None):
                attrs["consumption_basis"] = str(instance.consumption_basis).upper()
            elif category_code in {"ADDON", "POD"}:
                attrs["consumption_basis"] = "CATEGORY_FORMULA"
            elif category_code in {"CHEMICAL", "ADHESIVE", "SOLVENT"}:
                attrs["consumption_basis"] = "SNAPSHOT_GSM"
            else:
                legacy_mode = str(
                    attrs.get("quantity_mode")
                    or getattr(instance, "quantity_mode", "KG")
                    or "KG"
                ).upper()
                attrs["consumption_basis"] = {
                    "KG": "FIXED_KG",
                    "PCS": "FIXED_PCS",
                    "GSM": "SNAPSHOT_GSM",
                    "PERCENT": "INVALID_LEGACY",
                    "RECIPE": "INVALID_LEGACY",
                }.get(legacy_mode, "FIXED_KG")
        basis = str(attrs.get("consumption_basis") or "").upper()
        if not attrs.get("formula_driver"):
            if instance and getattr(instance, "formula_driver", None):
                attrs["formula_driver"] = str(instance.formula_driver).upper()
            elif basis == "CATEGORY_FORMULA" and category_code == "ADDON":
                attrs["formula_driver"] = "ADDON_MASTER_WEIGHT_MODE"
            elif basis == "CATEGORY_FORMULA" and category_code == "POD":
                attrs["formula_driver"] = "POD_MASTER_PROFILE"
            else:
                attrs["formula_driver"] = "NONE"
        if attrs.get("formula_params") is None:
            attrs["formula_params"] = (
                getattr(instance, "formula_params", {}) if instance else {}
            )
        if not isinstance(attrs.get("formula_params"), dict):
            raise serializers.ValidationError({"formula_params": "formula_params must be an object."})
        if ink_legacy:
            attrs["consumption_basis"] = "INVALID_LEGACY"
            attrs["formula_driver"] = "NONE"
            attrs["formula_params"] = {}
            attrs["issue_policy_mode"] = "NONE"
            attrs["issue_policy_value"] = 0
            attrs["capture_mode"] = "OPERATOR_REQUIRED"
        if not attrs.get("issue_policy_mode"):
            if instance and getattr(instance, "issue_policy_mode", None):
                attrs["issue_policy_mode"] = str(instance.issue_policy_mode).upper()
            else:
                attrs["issue_policy_mode"] = "NONE"
        if attrs.get("issue_policy_value") is None:
            if instance and getattr(instance, "issue_policy_value", None) is not None:
                attrs["issue_policy_value"] = instance.issue_policy_value
            else:
                attrs["issue_policy_value"] = 0
        if not attrs.get("capture_mode"):
            if instance and getattr(instance, "capture_mode", None):
                attrs["capture_mode"] = str(instance.capture_mode).upper()
            else:
                category = str(attrs.get("category_code") or "").upper()
                if category in {"ADHESIVE", "SOLVENT", "CHEMICAL"}:
                    attrs["capture_mode"] = "AUTO_ESTIMATED_CONFIRM"
                else:
                    attrs["capture_mode"] = "AUTO_FROM_OUTPUT"
        if not attrs.get("quantity_mode"):
            attrs["quantity_mode"] = str(
                attrs.get("quantity_mode")
                or getattr(instance, "quantity_mode", "KG")
                or "KG"
            ).upper()
        if attrs.get("value") is None:
            attrs["value"] = getattr(instance, "value", 0) if instance else 0
        if attrs.get("is_optional") is None:
            attrs["is_optional"] = bool(getattr(instance, "is_optional", False)) if instance else False

        if str(attrs.get("source_kind") or "CATEGORY").upper() != "CATEGORY":
            raise serializers.ValidationError({"source_kind": "Only CATEGORY mapping is allowed."})
        basis = str(attrs.get("consumption_basis") or "").upper()
        if category_code == "ADDON" and basis != "CATEGORY_FORMULA":
            raise serializers.ValidationError({"consumption_basis": "ADDON category must use CATEGORY_FORMULA."})
        if category_code == "POD" and basis != "CATEGORY_FORMULA":
            raise serializers.ValidationError({"consumption_basis": "POD category must use CATEGORY_FORMULA."})
        if basis == "SNAPSHOT_GSM" and category_code in {"ADDON", "POD"}:
            raise serializers.ValidationError({"consumption_basis": f"{category_code} category cannot use SNAPSHOT_GSM."})
        if basis == "CATEGORY_FORMULA":
            if str(attrs.get("formula_driver") or "NONE").upper() == "NONE":
                raise serializers.ValidationError({"formula_driver": "CATEGORY_FORMULA requires formula_driver."})
            if category_code == "ADDON" and str(attrs.get("formula_driver") or "").upper() != "ADDON_MASTER_WEIGHT_MODE":
                raise serializers.ValidationError({"formula_driver": "ADDON requires ADDON_MASTER_WEIGHT_MODE."})
            if category_code == "POD" and str(attrs.get("formula_driver") or "").upper() != "POD_MASTER_PROFILE":
                raise serializers.ValidationError({"formula_driver": "POD requires POD_MASTER_PROFILE."})
        elif str(attrs.get("formula_driver") or "NONE").upper() != "NONE":
            attrs["formula_driver"] = "NONE"
            attrs["formula_params"] = {}
        if str(attrs.get("capture_mode") or "").upper() not in {
            "AUTO_FROM_OUTPUT",
            "AUTO_ESTIMATED_CONFIRM",
            "OPERATOR_REQUIRED",
        }:
            raise serializers.ValidationError({"capture_mode": "Unsupported capture mode."})
        if str(attrs.get("issue_policy_mode") or "").upper() not in {
            "NONE",
            "PERCENT_OVER_THEORY",
            "FIXED_EXTRA_KG",
            "MINIMUM_ISSUE_KG",
        }:
            raise serializers.ValidationError({"issue_policy_mode": "Unsupported issue policy mode."})
        if str(attrs.get("consumption_basis") or "").upper() not in {
            "SNAPSHOT_GSM",
            "FIXED_KG",
            "FIXED_PCS",
            "CATEGORY_FORMULA",
            "INVALID_LEGACY",
        }:
            raise serializers.ValidationError({"consumption_basis": "Unsupported consumption basis."})
        if str(attrs.get("formula_driver") or "").upper() not in {
            "NONE",
            "ADDON_MASTER_WEIGHT_MODE",
            "POD_MASTER_PROFILE",
        }:
            raise serializers.ValidationError({"formula_driver": "Unsupported formula driver."})

        return attrs


class TemplateProcessStepRollHandlingSerializer(serializers.ModelSerializer):
    class Meta:
        model = TemplateProcessStepRollSpec
        fields = [
            "id",
            "template_step",
            "input_roll_count",
            "combine_mode",
            "input_lane_count",
            "lamination_pass_index",
            "active_min_layer_count",
            "adhesive_split_pct",
            "solvent_split_pct",
            "lane_schema",
            "thickness_rule",
            "width_rule",
            "operator_entry_mode",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TemplateProcessStepSerializer(serializers.ModelSerializer):
    process_name = serializers.ReadOnlyField(source="process.name")
    process_code = serializers.ReadOnlyField(source="process.code")
    process_input_form = serializers.ReadOnlyField(source="process.input_form")
    process_output_form = serializers.ReadOnlyField(source="process.output_form")
    process_roll_behavior = serializers.ReadOnlyField(source="process.roll_behavior")
    process_has_artwork = serializers.ReadOnlyField(source="process.has_artwork")
    process_transition = serializers.ReadOnlyField(source="process.transition")
    cost_absorption_group_code = serializers.ReadOnlyField(source="cost_absorption_group.code")
    default_work_center_code = serializers.ReadOnlyField(source="default_work_center.code")
    default_work_center_name = serializers.ReadOnlyField(source="default_work_center.name")
    materials = TemplateProcessStepMaterialSerializer(many=True, read_only=True)
    roll_handling = TemplateProcessStepRollHandlingSerializer(source="roll_spec", read_only=True)
    dispatch_status = serializers.SerializerMethodField()

    def get_dispatch_status(self, obj):
        from .services import TemplateDispatchService

        return TemplateDispatchService.step_status(obj)

    class Meta:
        model = TemplateProcessStep
        fields = [
            "id",
            "template",
            "sequence_number",
            "process",
            "process_name",
            "process_code",
            "process_input_form",
            "process_output_form",
            "process_roll_behavior",
            "process_has_artwork",
            "process_transition",
            "cost_absorption_group",
            "cost_absorption_group_code",
            "allowed_work_center_ids",
            "default_work_center",
            "default_work_center_code",
            "default_work_center_name",
            "work_center_selection_policy",
            "dispatch_notes",
            "dispatch_updated_at",
            "dispatch_status",
            "notes",
            "materials",
            "roll_handling",
            "is_removed_from_route",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TemplateDetailSerializer(TemplateBlueprintSerializer):
    process_steps = TemplateProcessStepSerializer(many=True, read_only=True)
    theoretical_requirements = serializers.SerializerMethodField()
    physics_snapshot = serializers.SerializerMethodField()

    def get_theoretical_requirements(self, obj):
        rows = []
        for step in obj.process_steps.prefetch_related("materials").all():
            for mat in step.materials.all():
                rows.append(
                    {
                        "step_id": str(step.id),
                        "step_sequence": step.sequence_number,
                        "category": str(mat.category_code or "").upper(),
                        "name": str(mat.category_code or "").upper(),
                        "consumption_basis": mat.consumption_basis,
                        "formula_driver": getattr(mat, "formula_driver", "NONE"),
                        "formula_params": getattr(mat, "formula_params", {}) or {},
                        "issue_policy_mode": mat.issue_policy_mode,
                        "issue_policy_value": float(mat.issue_policy_value or 0),
                        "capture_mode": mat.capture_mode,
                        "quantity_mode": mat.quantity_mode,
                        "value": float(mat.value or 0),
                        "weight_kg": float(mat.value or 0) if str(mat.quantity_mode or "").upper() == "KG" else 0,
                        "is_optional": bool(mat.is_optional),
                    }
                )
        return rows

    def get_physics_snapshot(self, obj):
        return {}

    class Meta(TemplateBlueprintSerializer.Meta):
        fields = TemplateBlueprintSerializer.Meta.fields + [
            "process_steps",
            "theoretical_requirements",
            "physics_snapshot",
        ]
