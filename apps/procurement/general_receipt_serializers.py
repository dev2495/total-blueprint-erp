"""Input validation for General Receipts (non-stock goods and services)."""
from decimal import ROUND_HALF_UP, Decimal

from rest_framework import serializers

from apps.gate.serializers import ActionInputSerializer
from apps.procurement.models import GENERAL_LINE_CATEGORIES, GENERAL_LINE_DISPOSITIONS, GENERAL_RECEIPT_TYPES, GENERAL_UOMS

# GST slabs accepted on a receipt line (40 % is the GST 2.0 special slab).
GST_RATES = (Decimal("0"), Decimal("5"), Decimal("12"), Decimal("18"), Decimal("28"), Decimal("40"))
CENT = Decimal("0.01")
NON_GOODS_LINE_CATEGORIES = {"SERVICE", "CHARGE"}


class GeneralReceiptLineInputSerializer(serializers.Serializer):
    line_category = serializers.ChoiceField(choices=[code for code, _ in GENERAL_LINE_CATEGORIES])
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    uom = serializers.ChoiceField(choices=GENERAL_UOMS)
    rate = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0"), required=False, allow_null=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    disposition = serializers.ChoiceField(choices=[code for code, _ in GENERAL_LINE_DISPOSITIONS], default="NOT_APPLICABLE")
    machine = serializers.UUIDField(required=False, allow_null=True)
    equipment_text = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    serial_no = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    remarks = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    gate_pass_line = serializers.UUIDField(required=False, allow_null=True)
    returned_quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"), required=False, allow_null=True)

    def validate_description(self, value):
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Describe the item or work (at least 2 characters).")
        return value

    def validate_gst_rate(self, value):
        if value is not None and value not in GST_RATES:
            raise serializers.ValidationError("Choose GST 0, 5, 12, 18, 28 or 40 %.")
        return value

    def validate(self, data):
        quantity, rate, amount = data["quantity"], data.get("rate"), data.get("amount")
        if rate is not None:
            computed = (quantity * rate).quantize(CENT, rounding=ROUND_HALF_UP)
            if amount is not None and abs(amount - computed) > CENT:
                raise serializers.ValidationError({"amount": f"Amount must equal quantity × rate = {computed}."})
            data["amount"] = computed
        elif amount is not None:
            data["rate"] = (amount / quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        data["equipment_text"] = " ".join(str(data.get("equipment_text") or "").split())
        data["serial_no"] = str(data.get("serial_no") or "").strip()
        data["remarks"] = str(data.get("remarks") or "").strip()
        if data["disposition"] == "INSTALLED" and not data.get("machine") and not data["equipment_text"]:
            raise serializers.ValidationError({"machine": "Choose the machine it was installed on, or type the equipment name."})
        if data.get("returned_quantity") is not None and not data.get("gate_pass_line"):
            raise serializers.ValidationError({"returned_quantity": "Choose the gate pass line this item came back on."})
        if data.get("gate_pass_line") and data.get("returned_quantity") is None:
            data["returned_quantity"] = quantity
        return data


class GeneralReceiptCreateSerializer(ActionInputSerializer):
    plant = serializers.UUIDField()
    document = serializers.UUIDField(required=False, allow_null=True)
    followup_of_bill = serializers.UUIDField(required=False, allow_null=True)
    bill_complete = serializers.BooleanField(default=False)
    vendor = serializers.UUIDField(required=False, allow_null=True)
    party_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    invoice_number = serializers.CharField(max_length=80, required=False, allow_blank=True)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    receipt_type = serializers.ChoiceField(choices=[code for code, _ in GENERAL_RECEIPT_TYPES])
    received_at = serializers.DateTimeField()
    received_by = serializers.UUIDField(required=False, allow_null=True)
    reference = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    duplicate_override_reason = serializers.CharField(min_length=5, max_length=500, required=False)
    lines = GeneralReceiptLineInputSerializer(many=True, min_length=1, max_length=100)

    def validate(self, data):
        if data.get("document") and data.get("followup_of_bill"):
            raise serializers.ValidationError({"followup_of_bill": "Choose either the bill being received or the old non-stock bill being followed up, not both."})
        if data.get("bill_complete") and not data.get("document"):
            raise serializers.ValidationError({"bill_complete": "Only a receipt against an open bill can complete it."})
        categories = [line["line_category"] for line in data["lines"]]
        if data["receipt_type"] == "SERVICE" and "SERVICE" not in categories:
            raise serializers.ValidationError({"lines": "A service receipt needs at least one Service / labour line."})
        if data["receipt_type"] == "GOODS" and all(category in NON_GOODS_LINE_CATEGORIES for category in categories):
            raise serializers.ValidationError({"lines": "A goods receipt needs at least one goods line (not only service or freight lines)."})
        gate_lines = [str(line["gate_pass_line"]) for line in data["lines"] if line.get("gate_pass_line")]
        if len(gate_lines) != len(set(gate_lines)):
            raise serializers.ValidationError({"lines": "Use each gate pass line once per receipt; combine the returned quantity on one line."})
        return data


class GeneralReceiptReverseSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)
