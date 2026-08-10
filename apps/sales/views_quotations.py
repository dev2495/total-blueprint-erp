import logging
import hashlib
from html import escape
from decimal import Decimal

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from .models import Quotation, QuotationArtifact, QuotationDelivery, QuotationItem
from .serializers_quotations import QuotationSerializer
from .services.quotation_costing import QuotationCostingService
from .services.quotation_cost_build import QuotationCostBuildService
from .services.quotation_lifecycle import QuotationLifecycleService, _can
from .services.quotation_pdf import QuotationPDFService
from .services.quotation_service import QuotationService

logger = logging.getLogger(__name__)


def _safe_dec(value):
    if value in (None, ""):
        return None
    try:
        parsed = Decimal(str(value))
    except Exception:
        return None
    return parsed if parsed.is_finite() else None


def _effective_layer_gsm(layer):
    gsm = _safe_dec(layer.get("gsm")) or Decimal("0")
    if gsm > 0:
        return gsm
    micron = _safe_dec(layer.get("micron")) or Decimal("0")
    density = _safe_dec(layer.get("density_gcm3")) or Decimal("0")
    if micron > 0 and density > 0:
        return micron * density
    return Decimal("0")


def _quote_item_readiness_errors(items):
    errors = []
    for item in items:
        label = item.line_name or str(item.id)
        spec = dict(item.spec_snapshot or {})
        layers = list(spec.get("layers") or item.layer_snapshot or [])
        if item.line_kind == "CATALOG":
            if not spec.get("product_master_id"):
                errors.append(f"{label}: pick a Product Master.")
            if not spec.get("size_id"):
                errors.append(f"{label}: pick a saved size.")
        if item.line_kind == "AD_HOC":
            if not spec.get("base_product_master_id"):
                errors.append(f"{label}: pick a base Product Master layer stack first.")
            if not spec.get("pouch_style_id"):
                errors.append(f"{label}: pick an approved pouch style.")
        if not (_safe_dec(spec.get("width_mm")) or Decimal("0")) or not (
            _safe_dec(spec.get("height_mm")) or Decimal("0")
        ):
            errors.append(f"{label}: enter finished width and height.")
        if not layers:
            errors.append(f"{label}: add at least one film layer.")
        for idx, layer in enumerate(layers):
            if not isinstance(layer, dict):
                errors.append(f"{label}: L{idx + 1} has an invalid layer row.")
                continue
            if not layer.get("material_id"):
                errors.append(f"{label}: L{idx + 1} needs material.")
            if _effective_layer_gsm(layer) <= 0:
                errors.append(f"{label}: L{idx + 1} needs GSM.")
            if not layer.get("material_id") and (_safe_dec(layer.get("rate_per_kg")) or Decimal("0")) <= 0:
                errors.append(f"{label}: L{idx + 1} needs material costing or manual rate.")
        ink_gsm = _safe_dec(spec.get("ink_gsm")) or _safe_dec(
            (spec.get("ink") or {}).get("gsm") if isinstance(spec.get("ink"), dict) else None
        ) or Decimal("0")
        if spec.get("print_capable") and spec.get("artwork_required") and not spec.get("artwork_id") and ink_gsm <= 0:
            errors.append(f"{label}: select approved artwork or enter manual ink GSM.")
        costing = item.costing_snapshot if isinstance(item.costing_snapshot, dict) else {}
        if (_safe_dec(costing.get("total_cost_per_kg")) or Decimal("0")) <= 0:
            errors.append(f"{label}: cost preview must calculate before send/approve.")
    return errors


class QuotationViewSet(viewsets.ModelViewSet):
    queryset = (
        Quotation.objects.select_related("customer", "plant", "plant__legal_profile", "converted_sales_order")
        .prefetch_related(
            "items", "items__template", "approval_gates", "deliveries__artifact", "audit_events",
            "cost_build__components",
        )
        .order_by("-updated_at", "-created_at")
    )
    serializer_class = QuotationSerializer

    def create(self, request, *args, **kwargs):
        try:
            quotation = QuotationService.create_quotation(request.data, user=request.user)
            return Response(self.get_serializer(quotation).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    def update(self, request, *args, **kwargs):
        quotation = self.get_object()
        try:
            quotation = QuotationService.update_quotation(quotation, request.data, user=request.user)
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="preview-line")
    def preview_line(self, request):
        try:
            preview = QuotationService.preview_line(request.data)
            return Response(preview)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="bulk-update-items")
    def bulk_update_items(self, request, pk=None):
        """V37 nested write — replace the item list with the supplied rows.

        Body: { "items": [ {line_kind, qty, rate, line_total, spec_snapshot, ...}, ... ] }
        """
        quotation = self.get_object()
        items_payload = (request.data or {}).get("items") or []
        try:
            QuotationService.bulk_update_items(quotation, items_payload, user=request.user)
            quotation.refresh_from_db()
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Commercial quotations are never deleted. Use cancel or void with a reason."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["get", "post"], url_path="cost-build")
    def cost_build(self, request, pk=None):
        quotation = self.get_object()
        if request.method == "GET":
            try:
                snapshot = quotation.cost_build
            except Exception:
                return Response({"status": "NOT_STARTED", "readiness": {"ready": False, "errors": ["Cost Build has not been saved."]}})
            return Response({
                "id": str(snapshot.id), "status": snapshot.status, "currency": snapshot.currency,
                "pricing_definition": snapshot.pricing_definition, "target_percent": snapshot.target_percent,
                "material_cost": snapshot.material_cost, "conversion_cost": snapshot.conversion_cost,
                "total_cost": snapshot.total_cost, "list_price": snapshot.list_price,
                "discount_amount": snapshot.discount_amount, "net_sale": snapshot.net_sale,
                "tax_amount": snapshot.tax_amount, "rounding_amount": snapshot.rounding_amount,
                "grand_total": snapshot.grand_total, "contribution": snapshot.contribution,
                "markup_pct": snapshot.markup_pct, "gross_margin_pct": snapshot.gross_margin_pct,
                "formula_version": snapshot.formula_version, "readiness": snapshot.readiness_snapshot,
                "sensitivity": snapshot.sensitivity_snapshot, "source_snapshot": snapshot.source_snapshot,
                "checksum": snapshot.checksum,
                "components": [
                    {
                        "id": str(row.id), "quotation_item_id": str(row.quotation_item_id or ""),
                        "category": row.category, "role": row.role, "label": row.label,
                        "material_id": str(row.material_id or ""),
                        "material_code": row.material.code if row.material_id else "",
                        "material_name": row.material.name if row.material_id else "",
                        "source_type": row.source_type,
                        "source_ref": row.source_ref, "source_lot_ref": row.source_lot_ref,
                        "source_effective_at": row.source_effective_at, "baseline_rate": row.baseline_rate,
                        "baseline_available_qty": row.baseline_available_qty, "baseline_uom": row.baseline_uom,
                        "quote_quantity": row.quote_quantity, "quote_uom": row.quote_uom,
                        "effective_rate": row.effective_rate, "component_cost": row.component_cost,
                        "override_rate": row.override_rate, "override_reason": row.override_reason,
                        "override_status": row.override_status, "override_expires_at": row.override_expires_at,
                        "readiness_status": row.readiness_status, "provenance": row.provenance,
                    }
                    for row in snapshot.components.select_related("material").all()
                ],
            })
        try:
            result = QuotationCostBuildService.persist(quotation, request.data or {}, user=request.user)
            return Response(result)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="approve-cost-overrides")
    def approve_cost_overrides(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.approve_cost_overrides(
                self.get_object(), user=request.user, reason=str((request.data or {}).get("reason") or "")
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.submit(self.get_object(), user=request.user)
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=False, methods=["post"], url_path="cost-preview")
    def cost_preview(self, request):
        return Response(
            {
                "detail": (
                    "The legacy stateless cost preview is retired because it could use ungoverned defaults. "
                    "Save the draft first, then use /quotations/{id}/cost-build/ for source-backed costing."
                )
            },
            status=status.HTTP_410_GONE,
        )

    @action(detail=False, methods=["post"], url_path="production-preview")
    def production_preview(self, request):
        return Response(
            {
                "detail": (
                    "The legacy production estimate is retired because it used fixed web, roll-weight, and speed constants. "
                    "Configure Web Width Policy, machine/process rates, and inventory sources before a governed preview."
                )
            },
            status=status.HTTP_410_GONE,
        )
    @action(detail=True, methods=["post"], url_path="clone-revision")
    def clone_revision(self, request, pk=None):
        from copy import deepcopy
        from apps.materials.models import ProductMaster, ProductMasterSize, ProductVariant

        original = self.get_object()
        try:
            with transaction.atomic():
                original = Quotation.objects.select_for_update().get(pk=original.pk)
                next_revision = (
                    Quotation.objects.select_for_update()
                    .filter(revision_root_id=original.revision_root_id)
                    .order_by("-revision_no")
                    .values_list("revision_no", flat=True)
                    .first()
                    or original.revision_no
                ) + 1
                clone = Quotation.objects.create(
                    customer=original.customer, customer_name=original.customer_name,
                    enquiry_reference=original.enquiry_reference, contact_name=original.contact_name,
                    contact_email=original.contact_email, contact_phone=original.contact_phone,
                    billing_address=original.billing_address, shipping_address=original.shipping_address,
                    plant=original.plant, status="DRAFT", valid_until=original.valid_until,
                    currency=original.currency, terms=original.terms, payment_terms=original.payment_terms,
                    delivery_terms=original.delivery_terms, requested_delivery_date=original.requested_delivery_date,
                    place_of_supply=original.place_of_supply, tax_snapshot=deepcopy(original.tax_snapshot or {}),
                    notes=original.notes, custom_terms=original.custom_terms, discount_pct=original.discount_pct,
                    discount_amount=original.discount_amount, freight_amount=original.freight_amount,
                    freight_included=original.freight_included, other_charges=deepcopy(original.other_charges or []),
                    gst_rate=original.gst_rate, parent_quotation=original,
                    revision_root_id=original.revision_root_id, revision_no=next_revision,
                )
                item_payloads = []
                for item in original.items.select_related("product_master", "product_variant", "product_master_size").all():
                    old_pm = item.product_master
                    current_pm = old_pm
                    if old_pm and not old_pm.is_current_version:
                        current_pm = ProductMaster.objects.filter(
                            version_group=old_pm.version_group, active=True, is_current_version=True
                        ).first()
                    if not current_pm:
                        raise ValueError(f"{item.line_name}: no current Base Product Master version is available.")
                    variant_id = None
                    size_id = None
                    if item.line_kind == "CATALOG":
                        if item.product_variant_id:
                            match = ProductVariant.objects.filter(
                                master=current_pm, code=item.product_variant.code, active=True
                            ).first()
                            if not match:
                                raise ValueError(f"{item.line_name}: ready Product Variant is not available under the current Product Master version.")
                            variant_id = str(match.id)
                        if item.product_master_size_id:
                            match_size = ProductMasterSize.objects.filter(
                                product_master=current_pm, code=item.product_master_size.code, active=True
                            ).first()
                            if not match_size:
                                raise ValueError(f"{item.line_name}: Product Size is not available under the current Product Master version.")
                            size_id = str(match_size.id)
                    spec = deepcopy(item.spec_snapshot or {})
                    spec["base_product_master_id"] = str(current_pm.id)
                    spec.pop("product_master_id", None)
                    spec.pop("save_as_master", None)
                    item_payloads.append({
                        "line_kind": item.line_kind, "line_name": item.line_name,
                        "product_master_id": str(current_pm.id), "product_variant_id": variant_id,
                        "size_id": size_id, "sku_variant_id": str(item.sku_variant_id or "") or None,
                        "pouch_style_id": str(item.pouch_style_master_id or "") or None,
                        "qty_value": str(item.qty_value), "qty_uom": item.qty_uom,
                        "price_basis": item.price_basis, "rate": str(item.quoted_unit_price),
                        "spec_snapshot": spec, "printing_snapshot": deepcopy(item.printing_snapshot or {}),
                        "packaging_snapshot": deepcopy(item.packaging_snapshot or {}),
                        "hsn_code": item.hsn_code, "gst_rate": str(item.gst_rate),
                    })
                QuotationService.bulk_update_items(clone, item_payloads, user=request.user)
            return Response(self.get_serializer(clone).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))
    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request, pk=None):
        from apps.users.services.email_service import EmailDeliveryService

        quotation = self.get_object()
        recipients = (request.data or {}).get("recipients") or [quotation.contact_email]
        recipients = sorted({str(value).strip().lower() for value in recipients if str(value).strip()})
        try:
            if quotation.status != "APPROVED":
                raise ValueError("Only an approved frozen revision can be sent.")
            if not _can(request.user, "sales.quote.send"):
                raise ValueError("You do not have permission to release client quotations.")
            if not recipients:
                raise ValueError("At least one client email recipient is required.")
            governed_recipient = str(quotation.contact_email or "").strip().lower()
            if not governed_recipient or any(recipient != governed_recipient for recipient in recipients):
                raise ValueError(
                    "Client quotation may only be released to the frozen quotation contact email. "
                    "Create a new revision to change the recipient."
                )
            configured, reason = EmailDeliveryService.configuration_status()
            if not configured:
                raise ValueError(f"Email delivery is not configured: {reason}.")
            pdf_bytes = QuotationPDFService.render_pdf_bytes(quotation, customer_view=True)
            checksum = hashlib.sha256(pdf_bytes).hexdigest()
            filename = f"{quotation.quote_number}-R{quotation.revision_no}.pdf"
            # Create immutable release evidence before crossing the external
            # email boundary. A provider failure remains auditable instead of
            # disappearing in a rolled-back transaction.
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status != "APPROVED":
                    raise ValueError("Quotation status changed; reload before sending.")
                artifact = QuotationArtifact.objects.filter(
                    quotation=quotation, artifact_type="CLIENT_PDF", checksum=checksum
                ).first()
                if not artifact:
                    artifact = QuotationArtifact.objects.create(
                        quotation=quotation, artifact_type="CLIENT_PDF", filename=filename,
                        byte_length=len(pdf_bytes), checksum=checksum,
                        provenance={
                            "customer_view": True, "quotation_snapshot_checksum": quotation.frozen_snapshot.get("checksum"),
                            "cost_checksum": quotation.cost_build.checksum, "revision_no": quotation.revision_no,
                        },
                        generated_by=request.user,
                    )
                deliveries = []
                for recipient in recipients:
                    frozen_checksum = str((quotation.frozen_snapshot or {}).get("checksum") or "")
                    if not frozen_checksum:
                        raise ValueError("Approved quotation is missing its frozen revision checksum.")
                    idempotency_key = (
                        f"quotation:{quotation.id}:R{quotation.revision_no}:"
                        f"{frozen_checksum}:{recipient}"
                    )
                    delivery, _ = QuotationDelivery.objects.get_or_create(
                        idempotency_key=idempotency_key,
                        defaults={
                            "quotation": quotation, "artifact": artifact, "channel": "EMAIL",
                            "recipient": recipient, "requested_by": request.user,
                        },
                    )
                    deliveries.append(delivery)

            delivered = []
            for delivery in deliveries:
                if delivery.status == "DELIVERED":
                    delivered.append(delivery)
                    continue
                try:
                    result = EmailDeliveryService.send_email(
                        subject=f"Quotation {quotation.quote_number} / Revision {quotation.revision_no}",
                        body=(
                            f"<p>Dear {escape(quotation.contact_name)},</p>"
                            f"<p>Please find attached quotation <strong>{escape(quotation.quote_number)}</strong>, revision {quotation.revision_no}. "
                            f"It is valid until {quotation.valid_until:%d-%b-%Y}.</p>"
                        ),
                        recipients=[delivery.recipient], idempotency_key=delivery.idempotency_key,
                        attachments=[{"filename": filename, "content": pdf_bytes, "content_type": "application/pdf"}],
                    )
                except Exception as exc:
                    delivery.status = "FAILED"
                    delivery.error_text = str(exc)[:2000]
                    delivery.save(update_fields=["status", "error_text"])
                    logger.warning(
                        "Quotation client delivery failed for quote %s revision %s",
                        quotation.id,
                        quotation.revision_no,
                        exc_info=True,
                    )
                    raise ValueError(
                        "Email provider did not confirm delivery. The failed attempt is recorded; "
                        "retry from this approved revision."
                    ) from exc
                delivery.status = "DELIVERED"
                delivery.provider = str(result.get("provider") or "")
                delivery.provider_message_id = str(result.get("provider_message_id") or "")
                delivery.delivered_at = timezone.now()
                delivery.error_text = ""
                delivery.save(update_fields=["status", "provider", "provider_message_id", "delivered_at", "error_text"])
                delivered.append(delivery)
            if len(delivered) != len(recipients):
                raise ValueError("Not every requested recipient has delivery evidence.")
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status not in {"APPROVED", "SENT"}:
                    raise ValueError("Quotation status changed; reload before sending.")
                quotation.status = "SENT"
                quotation.sent_at = timezone.now()
                quotation.sent_by = request.user
                quotation.save(update_fields=["status", "sent_at", "sent_by", "updated_at"])
                from .models import QuotationAuditEvent
                QuotationAuditEvent.objects.create(
                    quotation=quotation, event_type="CLIENT_DELIVERY_CONFIRMED",
                    after_snapshot={
                        "artifact_id": str(artifact.id), "artifact_checksum": checksum,
                        "delivery_ids": [str(row.id) for row in delivered], "recipients": recipients,
                    }, actor=request.user,
                )
            return Response({"id": str(quotation.id), "status": "SENT", "artifact_checksum": checksum, "recipients": recipients})
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.approve_gate(
                self.get_object(), gate=str((request.data or {}).get("gate") or "COMMERCIAL"),
                user=request.user, reason=str((request.data or {}).get("reason") or ""),
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.reject_approval(
                self.get_object(), gate=str((request.data or {}).get("gate") or "COMMERCIAL"),
                user=request.user, reason=str((request.data or {}).get("reason") or ""),
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="client-outcome")
    def client_outcome(self, request, pk=None):
        try:
            data = request.data or {}
            quotation = QuotationLifecycleService.record_client_outcome(
                self.get_object(), outcome=data.get("outcome"), reference=str(data.get("reference") or ""),
                channel=str(data.get("channel") or ""), reason=str(data.get("reason") or ""), user=request.user,
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.cancel_or_void(
                self.get_object(), action="CANCEL", reason=str((request.data or {}).get("reason") or ""), user=request.user
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        try:
            quotation = QuotationLifecycleService.cancel_or_void(
                self.get_object(), action="VOID", reason=str((request.data or {}).get("reason") or ""), user=request.user
            )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="expire")
    def expire(self, request, pk=None):
        quotation = self.get_object()
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status != "SENT":
                    raise ValueError("Only a sent quotation can expire.")
                if not quotation.valid_until or quotation.valid_until >= timezone.localdate():
                    raise ValueError("Quotation validity date has not elapsed.")
                quotation.status = "EXPIRED"
                quotation.save(update_fields=["status", "updated_at"])
                from .models import QuotationAuditEvent
                QuotationAuditEvent.objects.create(
                    quotation=quotation, event_type="EXPIRED", actor=request.user,
                    after_snapshot={"valid_until": quotation.valid_until.isoformat()},
                )
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))


    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        quotation = self.get_object()
        customer_view = str(request.query_params.get("customer_view") or "").lower() in ("1", "true", "yes")
        try:
            if customer_view and quotation.status not in {"APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"}:
                raise ValueError("Client PDF is only available for an approved frozen revision.")
            pdf_bytes = QuotationPDFService.render_pdf_bytes(
                quotation, customer_view=customer_view
            )
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            suffix = "-customer" if customer_view else ""
            response["Content-Disposition"] = f'inline; filename="{quotation.quote_number}{suffix}.pdf"'
            return response
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, pk=None):
        quotation = self.get_object()
        try:
            duplicate = QuotationService.duplicate_quotation(quotation)
            return Response(self.get_serializer(duplicate).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="convert-to-order")
    def convert_to_order(self, request, pk=None):
        quotation = self.get_object()
        if quotation.status != "ACCEPTED":
            return Response(
                {"detail": "Only an ACCEPTED delivered quotation can be converted to a sales order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status != "ACCEPTED":
                    return Response(
                        {"detail": "Only an ACCEPTED delivered quotation can be converted to a sales order."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                order = QuotationService.convert_to_sales_order(quotation)
            return Response(
                {
                    "sales_order_id": str(order.id),
                    "sales_order_number": order.order_number,
                    "quotation_id": str(quotation.id),
                    "quotation_number": quotation.quote_number,
                }
            )
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @staticmethod
    def _error_detail(exc):
        if hasattr(exc, "message_dict"):
            return exc.message_dict
        if hasattr(exc, "messages"):
            msgs = getattr(exc, "messages")
            if len(msgs) == 1:
                return msgs[0]
            return msgs
        return str(exc)

    @staticmethod
    def _error_status(exc):
        if exc.__class__.__name__ == "ValidationError" or isinstance(exc, ValueError):
            return status.HTTP_400_BAD_REQUEST
        return status.HTTP_500_INTERNAL_SERVER_ERROR
