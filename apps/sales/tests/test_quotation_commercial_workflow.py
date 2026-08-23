from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.costing.models import MaterialCostSnapshot, OrderCost, ProcessCostRate
from apps.factory.models import Plant, Process
from apps.materials.models import (
    InventoryMaterial,
    PouchStyleMaster,
    ProductMaster,
    ProductMasterSize,
    ProductVariant,
)
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, Quotation, QuotationAuditEvent, QuotationDelivery
from apps.sales.services.quotation_cost_build import QuotationCostBuildService
from apps.sales.services.quotation_lifecycle import QuotationLifecycleService
from apps.sales.services.quotation_pdf import QuotationPDFService
from apps.sales.services.quotation_service import QuotationService
from apps.sales.services.quotation_variance import QuotationVarianceService
from apps.templates.models import TemplateBlueprint
from apps.users.models import CompanyProfile


class QuotationCommercialWorkflowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.sales_user = User.objects.create_user(
            username="quote-sales",
            password="testpass",
            extra_permissions=["sales.quote.cost_override"],
        )
        self.approver = User.objects.create_superuser(
            username="quote-approver", email="approver@example.com", password="testpass"
        )
        self.customer = Customer.objects.create(
            code="QUOTE-CUSTOMER",
            name="Illustrative Test Customer",
            contact_person="Commercial Contact",
            email="client@example.com",
            phone="9999999999",
            billing_address="Billing address from Customer Master",
            shipping_address="Shipping address from Customer Master",
        )
        self.plant = Plant.objects.create(
            code="QUOTE-PLANT", name="Quotation Test Plant", default_margin_pct=Decimal("10")
        )
        self.process = Process.objects.create(
            code="QUOTE-PRINT", name="Quotation Printing", input_form="ROLL", output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        self.process_rate = ProcessCostRate.objects.create(
            process=self.process, cost_per_hour=Decimal("600"), is_active=True
        )
        route = RoutingRule.objects.create(name="Quotation governed route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Quotation current live pouch", fg_type="POUCH", status="LIVE", routing_rule=route
        )
        self.style = PouchStyleMaster.objects.create(
            code="QUOTE-STYLE", name="Quotation Style", locked=True, formula_kind="LINEAR"
        )
        self.base_product = ProductMaster.objects.create(
            code="QUOTE-BASE", name="Quotation Base Product", product_kind="POUCH",
            default_reporting_group="FG", template=self.template, active=True, is_current_version=True,
        )
        self.ready_size = ProductMasterSize.objects.create(
            product_master=self.base_product, code="120X180", label="120 x 180",
            width_mm=120, height_mm=180, qty_uom="KG", pouch_style_master=self.style,
            pouch_style_version=self.style.version,
        )
        self.materials = {}
        for category, code, rate, density in (
            ("FILM_FAMILY", "QUOTE-FILM", "180", "0.9200"),
            ("INK", "QUOTE-INK", "320", None),
            ("ADHESIVE", "QUOTE-ADH", "250", None),
            ("SOLVENT", "QUOTE-SOL", "110", None),
        ):
            material = InventoryMaterial.objects.create(
                code=code, name=code.replace("-", " "), category=category,
                base_uom="KG", density_gcm3=Decimal(density) if density else None, status="ACTIVE",
            )
            MaterialCostSnapshot.objects.create(material=material, avg_rate_per_kg=Decimal(rate), uom="KG")
            self.materials[category] = material
        profile = CompanyProfile.get_solo()
        profile.gstin = "24ABCDE1234F1Z5"
        profile.pan = "ABCDE1234F"
        profile.quote_terms_text = "Illustrative governed quotation terms."
        profile.save()

    def _new_quote(self):
        return QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "customer_name": self.customer.name,
                "plant": str(self.plant.id),
                "contact_name": self.customer.contact_person,
                "contact_email": self.customer.email,
                "contact_phone": self.customer.phone,
                "billing_address": self.customer.billing_address,
                "shipping_address": self.customer.shipping_address,
                "valid_until": (timezone.localdate() + timedelta(days=30)).isoformat(),
                "terms": "Illustrative governed quotation terms.",
                "payment_terms": "Payment terms captured for this test quote.",
                "delivery_terms": "Delivery terms captured for this test quote.",
                "gst_rate": "18",
            },
            user=self.sales_user,
        )

    def _quote_scoped_line(self):
        return {
            "line_kind": "AD_HOC",
            "line_name": "Quote-scoped configuration",
            "qty": "10",
            "uom": "KG",
            "price_basis": "KG",
            "rate": "500",
            "spec_snapshot": {
                "base_product_master_id": str(self.base_product.id),
                "pouch_style_id": str(self.style.id),
                "width_mm": "137",
                "height_mm": "219",
                "gusset_mm": "18",
                "layers": [{"material_id": str(self.materials["FILM_FAMILY"].id), "micron": "45"}],
                "inks": [{"material_id": str(self.materials["INK"].id), "gsm": "2"}],
                "adhesives": [{"material_id": str(self.materials["ADHESIVE"].id), "gsm": "3"}],
                "solvents": [{"material_id": str(self.materials["SOLVENT"].id), "gsm": "1"}],
                "additives": [],
                "addons": [],
            },
        }

    def _master_counts(self):
        return {
            "products": ProductMaster.objects.count(),
            "variants": ProductVariant.objects.count(),
            "sizes": ProductMasterSize.objects.count(),
            "styles": PouchStyleMaster.objects.count(),
            "materials": InventoryMaterial.objects.count(),
        }

    def _approved_quote(self):
        quote = self._new_quote()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        QuotationCostBuildService.persist(
            quote,
            {
                "pricing_definition": "MARKUP_ON_COST",
                "target_percent": "20",
                "conversion_components": [{
                    "category": "PROCESS", "label": "Printing", "source_type": "PROCESS_RATE",
                    "process_cost_rate_id": str(self.process_rate.id), "quantity": "1", "uom": "HOUR",
                    "basis": "PER_HOUR",
                }],
            },
            user=self.sales_user,
        )
        QuotationLifecycleService.submit(quote, user=self.sales_user)
        QuotationLifecycleService.approve_gate(
            quote, gate="COMMERCIAL", user=self.approver, reason="Commercial"
        )
        QuotationLifecycleService.approve_gate(
            quote, gate="FINANCE", user=self.approver, reason="Credit"
        )
        quote.refresh_from_db()
        return quote

    def test_two_paths_and_quote_scoped_variant_never_mutate_masters(self):
        quote = self._new_quote()
        before = self._master_counts()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        self.assertEqual(self._master_counts(), before)

        item = quote.items.get()
        self.assertEqual(item.product_master_id, self.base_product.id)
        self.assertIsNone(item.product_variant_id)
        self.assertIsNone(item.product_master_size_id)
        self.assertEqual(item.canonical_source_snapshot["path"], "B_QUOTE_SCOPED_VARIANT")
        self.assertFalse(item.canonical_source_snapshot["master_mutation"])
        self.assertEqual(item.spec_snapshot["quote_variant_kind"], "QUOTE_SCOPED_VARIANT")
        self.assertGreater(Decimal(item.spec_snapshot["total_gsm"]), Decimal("0"))
        self.assertGreater(Decimal(item.spec_snapshot["unit_weight_g"]), Decimal("0"))
        self.assertEqual(len(item.spec_snapshot["inks"]), 1)
        self.assertEqual(len(item.spec_snapshot["adhesives"]), 1)
        self.assertEqual(len(item.spec_snapshot["solvents"]), 1)

        fast_quote = self._new_quote()
        QuotationService.bulk_update_items(
            fast_quote,
            [{
                **self._quote_scoped_line(),
                "line_kind": "CATALOG",
                "size": str(self.ready_size.id),
                "spec_snapshot": {
                    **self._quote_scoped_line()["spec_snapshot"],
                    "product_master_id": str(self.base_product.id),
                    "size_id": str(self.ready_size.id),
                },
            }],
            user=self.sales_user,
        )
        fast_item = fast_quote.items.get()
        self.assertEqual(fast_item.canonical_source_snapshot["path"], "A_EXISTING_READY")
        self.assertEqual(fast_item.product_master_size_id, self.ready_size.id)
        self.assertEqual(self._master_counts(), before)

    def test_explicit_reusable_variant_save_is_cost_free_and_keeps_master_lineage(self):
        quote = self._new_quote()
        before = self._master_counts()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        item = quote.items.get()
        item.spec_snapshot["cost_overrides"] = [{
            "material_id": str(self.materials["FILM_FAMILY"].id),
            "role": "LAYER", "sequence": 1, "rate": "175",
            "reason": "Illustrative quote-only assumption",
            "expires_at": (timezone.now() + timedelta(days=7)).isoformat(),
        }]
        item.save(update_fields=["spec_snapshot"])

        saved_item, variant, created = QuotationService.save_quote_item_as_variant(
            quote,
            quotation_item_id=str(item.id),
            code="QUOTE-BASE-137X219",
            reason="Illustrative configuration approved for reuse",
            user=self.approver,
        )
        self.assertTrue(created)
        self.assertEqual(ProductVariant.objects.count(), before["variants"] + 1)
        self.assertEqual(ProductMaster.objects.count(), before["products"])
        self.assertEqual(ProductMasterSize.objects.count(), before["sizes"])
        self.assertEqual(PouchStyleMaster.objects.count(), before["styles"])
        self.assertEqual(InventoryMaterial.objects.count(), before["materials"])
        self.assertEqual(variant.master_id, self.base_product.id)
        self.assertEqual(saved_item.product_variant_id, variant.id)
        self.assertTrue(variant.spec_snapshot)
        serialized = str(variant.spec_snapshot)
        for forbidden in ("cost_overrides", "rate_per_kg", "cost_source_ref", "override_rate"):
            self.assertNotIn(forbidden, serialized)
        self.assertTrue(QuotationAuditEvent.objects.filter(quotation=quote, event_type="QUOTE_VARIANT_SAVED").exists())

        # A later draft save may keep the explicit linkage; it must not create
        # another master or silently promote a changed configuration.
        saved_item.refresh_from_db()
        QuotationService.bulk_update_items(
            quote,
            [{
                "line_kind": "AD_HOC",
                "line_name": saved_item.line_name,
                "qty": str(saved_item.qty_value),
                "uom": saved_item.qty_uom,
                "price_basis": saved_item.price_basis,
                "rate": str(saved_item.quoted_unit_price),
                "product_variant": str(variant.id),
                "spec_snapshot": saved_item.spec_snapshot,
            }],
            user=self.sales_user,
        )
        self.assertEqual(quote.items.get().product_variant_id, variant.id)
        self.assertEqual(ProductVariant.objects.count(), before["variants"] + 1)

    def test_ready_variant_fast_path_inherits_structure_and_rejects_shadow_bom_edit(self):
        quote = self._new_quote()
        technical = self._quote_scoped_line()["spec_snapshot"]
        variant = ProductVariant.objects.create(
            master=self.base_product,
            code="READY-137X219",
            geometry_snapshot={"width_mm": "137", "height_mm": "219", "gusset_mm": "18"},
            layer_snapshot=technical["layers"],
            spec_snapshot=technical,
            bom_signature="ready-variant-signature",
        )
        shadow_material = InventoryMaterial.objects.create(
            code="SHADOW-FILM", name="Shadow Film", category="FILM_FAMILY",
            base_uom="KG", density_gcm3=Decimal("0.9000"), status="ACTIVE",
        )
        QuotationService.bulk_update_items(
            quote,
            [{
                "line_kind": "CATALOG", "line_name": "Ready variant", "qty": "1000",
                "uom": "PCS", "price_basis": "PCS", "rate": "4.5",
                "product_master": str(self.base_product.id),
                "product_variant": str(variant.id),
                "spec_snapshot": {
                    **technical,
                    "product_master_id": str(self.base_product.id),
                    "width_mm": "140",
                    "layers": [{"material_id": str(shadow_material.id), "micron": "99"}],
                },
            }],
            user=self.sales_user,
        )
        item = quote.items.get()
        self.assertEqual(item.product_variant_id, variant.id)
        self.assertEqual(item.spec_snapshot["layers"][0]["material_id"], str(self.materials["FILM_FAMILY"].id))
        self.assertEqual(Decimal(item.spec_snapshot["width_mm"]), Decimal("140"))
        self.assertEqual(item.canonical_source_snapshot["path"], "A_EXISTING_READY")

    def test_component_key_allows_same_rm_to_have_different_line_assumptions(self):
        quote = self._new_quote()
        first = self._quote_scoped_line()
        second = {**self._quote_scoped_line(), "line_name": "Second quote configuration", "qty": "12"}
        QuotationService.bulk_update_items(quote, [first, second], user=self.sales_user)
        items = list(quote.items.order_by("created_at"))
        expires = (timezone.now() + timedelta(days=7)).isoformat()
        override_rows = []
        for index, item in enumerate(items):
            override_rows.append({
                "component_key": QuotationCostBuildService._component_key(
                    item.id, "LAYER", 1, self.materials["FILM_FAMILY"].id
                ),
                "material_id": str(self.materials["FILM_FAMILY"].id),
                "rate": str(171 + index),
                "reason": f"Illustrative line {index + 1} assumption",
                "expires_at": expires,
            })
        result = QuotationCostBuildService.persist(
            quote,
            {
                "cost_entry_mode": "CONVERSION_TOTAL",
                "pricing_definition": "MARKUP_ON_COST",
                "target_percent": "20",
                "material_overrides": override_rows,
                "conversion_components": [
                    {
                        "quotation_item_id": str(item.id),
                        "category": "PROCESS", "label": f"{item.line_name} conversion",
                        "source_type": "QUOTE_OVERRIDE", "rate": "35", "quantity": "0",
                        "uom": "KG", "basis": "PER_KG",
                        "override_reason": "Illustrative conversion assumption",
                        "override_expires_at": expires,
                    }
                    for item in items
                ],
            },
            user=self.sales_user,
        )
        layer_rows = [row for row in result["components"] if row["role"] == "LAYER"]
        self.assertEqual({row["effective_rate"] for row in layer_rows}, {"171", "172"})
        self.assertEqual(result["cost_entry_mode"], "CONVERSION_TOTAL")
        self.assertTrue(all(Decimal(row["quote_quantity"]) > 0 for row in result["components"] if row["category"] == "PROCESS"))
        quote.cost_build.refresh_from_db()
        self.assertEqual(quote.cost_build.cost_entry_mode, "CONVERSION_TOTAL")

    def test_pdf_is_traceable_client_safe_and_downloadable(self):
        quote = self._new_quote()
        quote.notes = "INTERNAL-COMMERCIAL-NOTE-DO-NOT-SEND"
        quote.save(update_fields=["notes"])
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        internal_pdf = QuotationPDFService.render_pdf_bytes(quote)
        client_pdf = QuotationPDFService.render_pdf_bytes(quote, customer_view=True)
        for marker in (b"QUOTE-BASE", b"QUOTE-STYLE", b"QUOTE-FILM", b"QUOTE-INK", b"Total"):
            self.assertIn(marker, client_pdf)
        self.assertIn(b"INTERNAL-COMMERCIAL-NOTE-DO-NOT-SEND", internal_pdf)
        self.assertNotIn(b"INTERNAL-COMMERCIAL-NOTE-DO-NOT-SEND", client_pdf)

        client = APIClient()
        client.force_authenticate(self.approver)
        response = client.get(f"/api/sales/quotations/{quote.id}/pdf/?download=1")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

    def test_cost_override_is_quote_only_and_requires_segregated_approval(self):
        quote = self._new_quote()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        baseline = self.materials["FILM_FAMILY"].cost_snapshots.latest("effective_date").avg_rate_per_kg
        expires = (timezone.now() + timedelta(days=7)).isoformat()
        result = QuotationCostBuildService.persist(
            quote,
            {
                "pricing_definition": "GROSS_MARGIN_ON_SALES",
                "target_percent": "25",
                "material_overrides": [{
                    "material_id": str(self.materials["FILM_FAMILY"].id),
                    "rate": "175",
                    "reason": "Illustrative negotiated supplier assumption",
                    "expires_at": expires,
                }],
                "conversion_components": [{
                    "category": "PROCESS", "label": "Printing", "source_type": "PROCESS_RATE",
                    "process_cost_rate_id": str(self.process_rate.id), "quantity": "1", "uom": "HOUR",
                    "basis": "PER_HOUR",
                }],
            },
            user=self.sales_user,
        )
        self.assertFalse(result["readiness"]["ready"])
        self.assertEqual(result["readiness"]["pending_override_count"], 1)
        self.assertEqual(
            self.materials["FILM_FAMILY"].cost_snapshots.latest("effective_date").avg_rate_per_kg,
            baseline,
        )
        with self.assertRaises(ValidationError):
            QuotationLifecycleService.approve_cost_overrides(quote, user=self.sales_user, reason="Self approval")
        QuotationLifecycleService.approve_cost_overrides(quote, user=self.approver, reason="Commercial evidence checked")
        quote.cost_build.refresh_from_db()
        self.assertTrue(quote.cost_build.readiness_snapshot["ready"])
        component = quote.cost_build.components.get(material=self.materials["FILM_FAMILY"])
        self.assertEqual(component.override_status, "APPROVED")
        self.assertEqual(component.override_by_id, self.sales_user.id)
        self.assertEqual(component.override_approved_by_id, self.approver.id)

    def test_cost_override_rejects_user_without_named_permission(self):
        unauthorized = get_user_model().objects.create_user(
            username="quote-no-override", password="testpass"
        )
        quote = self._new_quote()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        with self.assertRaises(ValidationError):
            QuotationCostBuildService.persist(
                quote,
                {
                    "pricing_definition": "MARKUP_ON_COST",
                    "target_percent": "20",
                    "material_overrides": [{
                        "material_id": str(self.materials["FILM_FAMILY"].id),
                        "rate": "175",
                        "reason": "Illustrative assumption",
                        "expires_at": (timezone.now() + timedelta(days=7)).isoformat(),
                    }],
                },
                user=unauthorized,
            )

    def test_freeze_send_accept_convert_once_carries_exact_snapshot_without_master_creation(self):
        quote = self._new_quote()
        QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)
        result = QuotationCostBuildService.persist(
            quote,
            {
                "pricing_definition": "MARKUP_ON_COST",
                "target_percent": "20",
                "conversion_components": [{
                    "category": "PROCESS", "label": "Printing", "source_type": "PROCESS_RATE",
                    "process_cost_rate_id": str(self.process_rate.id), "quantity": "1", "uom": "HOUR",
                    "basis": "PER_HOUR",
                }],
            },
            user=self.sales_user,
        )
        self.assertTrue(result["readiness"]["ready"], result["readiness"])
        before = self._master_counts()
        QuotationLifecycleService.submit(quote, user=self.sales_user)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "PENDING_APPROVAL")
        self.assertEqual(quote.cost_build.status, "FROZEN")
        with self.assertRaises(ValidationError):
            QuotationService.bulk_update_items(quote, [self._quote_scoped_line()], user=self.sales_user)

        QuotationLifecycleService.approve_gate(quote, gate="COMMERCIAL", user=self.approver, reason="Commercial")
        QuotationLifecycleService.approve_gate(quote, gate="FINANCE", user=self.approver, reason="Credit")
        quote.refresh_from_db()
        self.assertEqual(quote.status, "APPROVED")

        client = APIClient()
        client.force_authenticate(self.approver)
        with patch(
            "apps.users.services.email_service.EmailDeliveryService.configuration_status",
            return_value=(True, ""),
        ), patch(
            "apps.users.services.email_service.EmailDeliveryService.send_email",
            return_value={"provider": "TEST", "provider_message_id": "delivery-evidence-1"},
        ):
            response = client.post(
                f"/api/sales/quotations/{quote.id}/send/",
                {"recipients": [self.customer.email]},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.content)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "SENT")
        self.assertEqual(QuotationDelivery.objects.filter(quotation=quote, status="DELIVERED").count(), 1)

        QuotationLifecycleService.record_client_outcome(
            quote, outcome="ACCEPTED", reference="TEST-PO-001", channel="EMAIL",
            reason="", user=self.sales_user,
        )
        order = QuotationService.convert_to_sales_order(quote)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "CONVERTED")
        self.assertEqual(order.source_quotation_revision_id, quote.id)
        self.assertEqual(order.customer_po_reference, "TEST-PO-001")
        self.assertEqual(order.quote_cost_snapshot["checksum"], quote.cost_build.checksum)
        order_item = order.items.get()
        self.assertEqual(order_item.quote_variant_snapshot["kind"], "QUOTE_SCOPED_VARIANT")
        self.assertEqual(order_item.quote_variant_snapshot["base_product_master_id"], str(self.base_product.id))
        order_cost = OrderCost.objects.create(
            sales_order_item=order_item,
            material_cost_actual=Decimal("1400"),
            conversion_cost_actual=Decimal("400"),
            overhead_cost_absorbed=Decimal("100"),
            actual_cost_coverage_pct=Decimal("66.67"),
            costing_mode="HYBRID",
            coverage_flags=["Illustrative partial actual coverage"],
        )
        variance = QuotationVarianceService.refresh_for_order_item(order_item)
        self.assertIsNotNone(variance)
        self.assertEqual(variance.sales_order_item_id, order_item.id)
        self.assertEqual(variance.actual_total_cost, Decimal("1900"))
        self.assertEqual(variance.actual_coverage_pct, order_cost.actual_cost_coverage_pct)
        self.assertEqual(
            variance.source_snapshot["quotation_cost_checksum"], quote.cost_build.checksum
        )
        self.assertEqual(self._master_counts(), before)
        with self.assertRaises(ValidationError):
            QuotationService.convert_to_sales_order(quote)
        self.assertTrue(QuotationAuditEvent.objects.filter(quotation=quote, event_type="CONVERTED_ONCE").exists())

    def test_delete_is_forbidden_and_cancel_is_reasoned(self):
        quote = self._new_quote()
        client = APIClient()
        client.force_authenticate(self.sales_user)
        deleted = client.delete(f"/api/sales/quotations/{quote.id}/")
        self.assertEqual(deleted.status_code, 405)
        cancelled = client.post(
            f"/api/sales/quotations/{quote.id}/cancel/", {"reason": "Test enquiry withdrawn"}, format="json"
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "CANCELLED")
        self.assertEqual(quote.cancellation_reason, "Test enquiry withdrawn")
        self.assertTrue(Quotation.objects.filter(id=quote.id).exists())

    def test_failed_client_delivery_is_preserved_and_retry_is_idempotent(self):
        quote = self._approved_quote()
        client = APIClient()
        client.force_authenticate(self.approver)
        with patch(
            "apps.users.services.email_service.EmailDeliveryService.configuration_status",
            return_value=(True, ""),
        ), patch(
            "apps.users.services.email_service.EmailDeliveryService.send_email",
            side_effect=RuntimeError("Illustrative provider outage"),
        ):
            failed = client.post(
                f"/api/sales/quotations/{quote.id}/send/",
                {"recipients": [self.customer.email]},
                format="json",
            )
        self.assertEqual(failed.status_code, 400, failed.content)
        self.assertNotIn(b"provider outage", failed.content)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "APPROVED")
        delivery = QuotationDelivery.objects.get(quotation=quote, recipient=self.customer.email)
        self.assertEqual(delivery.status, "FAILED")
        self.assertIn("provider outage", delivery.error_text)

        with patch(
            "apps.users.services.email_service.EmailDeliveryService.configuration_status",
            return_value=(True, ""),
        ), patch(
            "apps.users.services.email_service.EmailDeliveryService.send_email",
            return_value={"provider": "TEST", "provider_message_id": "retry-evidence-1"},
        ):
            retried = client.post(
                f"/api/sales/quotations/{quote.id}/send/",
                {"recipients": [self.customer.email]},
                format="json",
            )
        self.assertEqual(retried.status_code, 200, retried.content)
        delivery.refresh_from_db()
        quote.refresh_from_db()
        self.assertEqual(QuotationDelivery.objects.filter(quotation=quote).count(), 1)
        self.assertEqual(delivery.status, "DELIVERED")
        self.assertEqual(delivery.provider_message_id, "retry-evidence-1")
        self.assertEqual(quote.status, "SENT")

    def test_client_release_cannot_exfiltrate_quote_to_unfrozen_recipient(self):
        quote = self._approved_quote()
        client = APIClient()
        client.force_authenticate(self.approver)
        attempted = client.post(
            f"/api/sales/quotations/{quote.id}/send/",
            {"recipients": ["not-the-frozen-client@example.com"]},
            format="json",
        )
        self.assertEqual(attempted.status_code, 400, attempted.content)
        quote.refresh_from_db()
        self.assertEqual(quote.status, "APPROVED")
        self.assertFalse(QuotationDelivery.objects.filter(quotation=quote).exists())
