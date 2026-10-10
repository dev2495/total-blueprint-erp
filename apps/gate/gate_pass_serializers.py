from decimal import Decimal

from rest_framework import serializers

from apps.procurement.models import GENERAL_UOMS

from .models import GATE_PASS_KINDS, GATE_PASS_PURPOSES
from .serializers import ActionInputSerializer


class GatePassLineInputSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
    uom = serializers.ChoiceField(choices=GENERAL_UOMS)
    machine = serializers.UUIDField(required=False, allow_null=True)
    equipment_text = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    serial_no = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    approx_value = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)
    remarks = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class GatePassInputSerializer(ActionInputSerializer):
    kind = serializers.ChoiceField(choices=[code for code, _ in GATE_PASS_KINDS])
    plant = serializers.UUIDField()
    vendor = serializers.UUIDField(required=False, allow_null=True)
    party_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    party_address = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    party_gstin = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    purpose = serializers.ChoiceField(choices=[code for code, _ in GATE_PASS_PURPOSES])
    expected_return_date = serializers.DateField(required=False, allow_null=True)
    vehicle_number = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    carried_by = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    lines = GatePassLineInputSerializer(many=True, allow_empty=False, max_length=50)


class GatePassUpdateSerializer(GatePassInputSerializer):
    version = serializers.IntegerField(min_value=0)


class GatePassIssueSerializer(ActionInputSerializer):
    version = serializers.IntegerField(min_value=0, required=False)


class GatePassReasonSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)


class ReturnLineSerializer(serializers.Serializer):
    line_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))


class GatePassReceiveSerializer(GatePassReasonSerializer):
    lines = ReturnLineSerializer(many=True, allow_empty=False, max_length=50)
