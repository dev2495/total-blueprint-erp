from django.test import TestCase

from apps.factory.models import Process
from apps.factory.serializers import ProcessSerializer


class ProcessStockFormCapabilitySerializerTests(TestCase):
    def test_stock_form_aliases_are_canonicalized(self):
        serializer = ProcessSerializer(
            data={
                "code": "CAP_TEST",
                "name": "Capability Test",
                "input_form": "ROLL",
                "output_form": "ROLL",
                "roll_behavior": "MODIFY_EXISTING",
                "allowed_input_stock_forms": ["sheet", "tube", "LAY_FLAT_TUBE", "folded"],
                "allowed_output_stock_forms": ["open web", "folded_web"],
                "stock_form_output_mode": "TARGET_DECIDES",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        process = serializer.save()

        self.assertEqual(process.allowed_input_stock_forms, ["OPEN_WEB", "LAYFLAT_TUBE", "FOLDED_WEB"])
        self.assertEqual(process.allowed_output_stock_forms, ["OPEN_WEB", "FOLDED_WEB"])

    def test_blank_capability_lists_mean_legacy_unrestricted(self):
        process = Process.objects.create(
            code="CAP_EMPTY",
            name="Unrestricted Legacy",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="NONE",
        )
        data = ProcessSerializer(process).data

        self.assertEqual(data["allowed_input_stock_forms"], [])
        self.assertEqual(data["allowed_output_stock_forms"], [])
        self.assertEqual(data["stock_form_output_mode"], "PRESERVE")
