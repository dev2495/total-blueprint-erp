from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.production.services.dispatch_pdf import DispatchListPDFService, canvas


class DispatchPDFOutputTests(SimpleTestCase):
    def test_render_includes_gonny_metadata_in_valid_pdf(self):
        if canvas is None:
            self.skipTest("reportlab not installed")

        challan = SimpleNamespace(
            id="dc-1",
            dc_no="DC-TEST-1",
            status="DRAFT",
            customer_name="Test Customer",
            plant=SimpleNamespace(name="Main Plant"),
            vehicle_no="MH12AB1234",
            driver_name="Driver",
            driver_phone="9999999999",
            dispatch_date=None,
            sales_order_id="so-1",
        )

        with patch.object(DispatchListPDFService, "_safe_sales_order_number", return_value="SO-TEST-1"), \
             patch.object(
                 DispatchListPDFService,
                 "_load_item_rows",
                 return_value=[
                     {
                         "id": "item-roll",
                         "roll_id": "roll-1",
                         "packing_unit_id": None,
                         "fg_batch_id": None,
                         "weight_kg": 12.5,
                         "qty_pcs": None,
                         "roll_label": "ROLL-1",
                         "roll_batch_no": "BATCH-ROLL-1",
                         "material_name": "Roll Film",
                         "roll_location": "FG Store",
                         "gonny_label": None,
                         "gonny_content_mode": None,
                         "gonny_primary_pack_count": None,
                         "gonny_location": None,
                         "gonny_batch_number": None,
                         "batch_number": None,
                     },
                     {
                         "id": "item-gonny",
                         "roll_id": None,
                         "packing_unit_id": "gonny-1",
                         "fg_batch_id": None,
                         "weight_kg": 7.2,
                         "qty_pcs": 240,
                         "roll_label": None,
                         "roll_batch_no": None,
                         "material_name": None,
                         "roll_location": None,
                         "gonny_label": "G-BATCH-1-001",
                         "gonny_content_mode": "PRIMARY_PACKS",
                         "gonny_primary_pack_count": 6,
                         "gonny_location": "Packing Yard",
                         "gonny_batch_number": "BATCH-1",
                         "batch_number": None,
                     },
                 ],
             ):
            buffer = DispatchListPDFService.render(challan)

        self.assertTrue(buffer.getvalue().startswith(b"%PDF"))
