import logging
from decimal import Decimal

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Quotation, QuotationItem
from .serializers_quotations import QuotationSerializer
from .services.quotation_costing import QuotationCostingService
from .services.quotation_pdf import QuotationPDFService
from .services.quotation_service import QuotationService

logger = logging.getLogger(__name__)


def _safe_dec(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


class QuotationViewSet(viewsets.ModelViewSet):
    queryset = (
        Quotation.objects.select_related("customer", "plant", "plant__legal_profile", "converted_sales_order")
        .prefetch_related("items", "items__template")
        .order_by("-updated_at", "-created_at")
    )
    serializer_class = QuotationSerializer

    def create(self, request, *args, **kwargs):
        try:
            quotation = QuotationService.create_quotation(request.data)
            return Response(self.get_serializer(quotation).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    def update(self, request, *args, **kwargs):
        quotation = self.get_object()
        try:
            quotation = QuotationService.update_quotation(quotation, request.data)
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
            QuotationService.bulk_update_items(quotation, items_payload)
            quotation.refresh_from_db()
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=False, methods=["post"], url_path="cost-preview")
    def cost_preview(self, request):
        """Stateless ad-hoc cost preview. Body:
        { spec: {...}, customer_id?, plant_id?, manual_margin_pct?, manual_rate? }
        """
        data = request.data or {}
        spec = data.get("spec") or {}
        customer = None
        plant = None
        customer_id = data.get("customer_id")
        plant_id = data.get("plant_id")
        if customer_id:
            from .models import Customer

            customer = Customer.objects.filter(id=customer_id).first()
        if plant_id:
            from apps.factory.models import Plant

            plant = Plant.objects.filter(id=plant_id).first()

        try:
            result = QuotationCostingService.compute(
                spec=spec,
                customer=customer,
                plant=plant,
                manual_margin_pct=_safe_dec(data.get("manual_margin_pct")),
                manual_rate=_safe_dec(data.get("manual_rate")),
            )
            return Response(result.to_dict())
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=False, methods=["post"], url_path="production-preview")
    def production_preview(self, request):
        """Lightweight production estimate for a single line spec.

        Returns approximate pouches/parent-roll, parent rolls needed,
        machine time and a `material_availability` list (the only piece
        that is currently load-bearing for sales — they want to know
        whether the BOM materials are in stock).

        Body: { spec: {...}, plant_id?, qty?, qty_uom? }
        """
        from decimal import Decimal
        data = request.data or {}
        spec = data.get("spec") or {}
        qty = _safe_dec(data.get("qty")) or Decimal("100")
        qty_uom = (data.get("qty_uom") or "KG").upper()

        # ── Pouch geometry → area ──
        width = _safe_dec(spec.get("width_mm")) or Decimal("0")
        height = _safe_dec(spec.get("height_mm")) or Decimal("0")
        gusset = _safe_dec(spec.get("gusset_mm")) or Decimal("0")
        # web length per pouch (approx, single-face flat or two-faces folded)
        web_length_mm = height + gusset
        # finished web width (mm) = pouch width + gusset (per side approximation)
        child_web_mm = width + gusset
        parent_web_mm = Decimal("440")  # typical 17" parent roll
        # area per pouch (single ply, m²)
        area_m2 = (Decimal("2") * width * height + Decimal("2") * gusset * height) / Decimal("1000000")

        # ── Layer GSM → grams per pouch ──
        layers = spec.get("layers") or []
        total_gsm = Decimal("0")
        for layer in layers:
            try:
                total_gsm += _safe_dec(layer.get("gsm")) or Decimal("0")
            except Exception:
                pass
        for extra in ("adhesive_gsm", "ink_gsm"):
            total_gsm += _safe_dec(spec.get(extra)) or Decimal("0")
        grams_per_pouch = area_m2 * total_gsm  # gsm = g/m² × m² = grams
        weight_per_pouch_kg = grams_per_pouch / Decimal("1000")

        # ── Convert qty into pouches and KG ──
        if qty_uom == "KG":
            total_kg = qty
            pouches_needed = (qty / weight_per_pouch_kg) if weight_per_pouch_kg > 0 else Decimal("0")
        else:
            pouches_needed = qty
            total_kg = qty * weight_per_pouch_kg

        # ── Parent roll yield ──
        try:
            lanes = int((parent_web_mm / child_web_mm) if child_web_mm > 0 else 1)
        except Exception:
            lanes = 1
        lanes = max(1, lanes)
        # 200 KG yields per parent roll, simple constant approximation
        parent_roll_kg = Decimal("200")
        parent_rolls_needed = (total_kg / parent_roll_kg) if parent_roll_kg > 0 else Decimal("0")
        pouches_per_parent_roll = Decimal("0")
        if weight_per_pouch_kg > 0:
            pouches_per_parent_roll = parent_roll_kg / weight_per_pouch_kg

        # ── Machine time: 25 KG/hour rough constant ──
        machine_time_hrs = total_kg / Decimal("25") if total_kg > 0 else Decimal("0")

        # ── Per-material availability ──
        availability_rows = []
        try:
            from apps.materials.models import InventoryMaterial
        except Exception:
            InventoryMaterial = None  # type: ignore

        for layer in layers:
            mat_id = layer.get("material_id")
            if not mat_id:
                continue
            gsm = _safe_dec(layer.get("gsm")) or Decimal("0")
            if total_gsm <= 0:
                needed_kg = Decimal("0")
            else:
                needed_kg = (gsm / total_gsm) * total_kg
            mat_code = layer.get("material_code") or ""
            mat_name = layer.get("name") or layer.get("material_name") or mat_code
            available_kg = Decimal("0")
            if InventoryMaterial is not None:
                try:
                    from apps.inventory.models import StockBalance
                    from django.db import models as djmodels
                    agg = StockBalance.objects.filter(material_id=mat_id).aggregate(
                        total=djmodels.Sum("qty")
                    )
                    available_kg = Decimal(str(agg["total"] or 0))
                except Exception as exc:
                    logger.warning(
                        "production-preview material availability lookup failed for %s: %s",
                        mat_id,
                        exc,
                        exc_info=True,
                    )
                    available_kg = Decimal("0")
            availability_rows.append({
                "material_id": str(mat_id),
                "material_code": mat_code,
                "material_name": mat_name,
                "needed_kg": float(needed_kg.quantize(Decimal("0.01"))),
                "available_kg": float(available_kg.quantize(Decimal("0.01"))),
                "ok": bool(available_kg >= needed_kg) if needed_kg > 0 else True,
            })

        return Response({
            "pouches_needed": float(pouches_needed.quantize(Decimal("1"))),
            "total_kg": float(total_kg.quantize(Decimal("0.01"))),
            "weight_per_pouch_g": float(grams_per_pouch.quantize(Decimal("0.001"))),
            "lanes_per_parent": lanes,
            "pouches_per_parent_roll": float(pouches_per_parent_roll.quantize(Decimal("1"))) * lanes,
            "parent_rolls_needed": float(parent_rolls_needed.quantize(Decimal("0.01"))),
            "machine_time_hrs": float(machine_time_hrs.quantize(Decimal("0.01"))),
            "child_web_mm": float(child_web_mm.quantize(Decimal("0.1"))),
            "material_availability": availability_rows,
            "note": (
                "Estimate uses single 440 mm parent web and 200 KG/roll constant. "
                "Wire to actual web-width policy + machine speeds for production-grade output."
            ),
        })

    @action(detail=True, methods=["post"], url_path="clone-revision")
    def clone_revision(self, request, pk=None):
        original = self.get_object()
        try:
            with transaction.atomic():
                original = Quotation.objects.select_for_update().get(pk=original.pk)
                items = list(original.items.all())
                clone = Quotation.objects.create(
                    customer=original.customer,
                    customer_name=original.customer_name,
                    plant=original.plant,
                    status="DRAFT",
                    valid_until=original.valid_until,
                    currency=original.currency,
                    terms=original.terms,
                    notes=original.notes,
                    totals_snapshot=dict(original.totals_snapshot or {}),
                    parent_quotation=original,
                    revision_no=original.revision_no + 1,
                )
                for it in items:
                    QuotationItem.objects.create(
                        quotation=clone,
                        template=it.template,
                        sku_variant=it.sku_variant,
                        line_name=it.line_name,
                        finished_good_type=it.finished_good_type,
                        roll_form=it.roll_form,
                        qty_value=it.qty_value,
                        qty_uom=it.qty_uom,
                        price_basis=it.price_basis,
                        geometry_snapshot=dict(it.geometry_snapshot or {}),
                        layer_snapshot=list(it.layer_snapshot or []),
                        printing_snapshot=dict(it.printing_snapshot or {}),
                        chemicals_snapshot=dict(it.chemicals_snapshot or {}),
                        addons_snapshot=list(it.addons_snapshot or []),
                        packaging_snapshot=dict(it.packaging_snapshot or {}),
                        physics_snapshot=dict(it.physics_snapshot or {}),
                        bom_snapshot=dict(it.bom_snapshot or {}),
                        process_cost_rows=list(it.process_cost_rows or []),
                        commercial_snapshot=dict(it.commercial_snapshot or {}),
                        costing_snapshot=dict(it.costing_snapshot or {}),
                        unit_weight_g=it.unit_weight_g,
                        total_weight_kg=it.total_weight_kg,
                        quoted_unit_price=it.quoted_unit_price,
                        quoted_line_total=it.quoted_line_total,
                        line_kind=it.line_kind,
                        spec_snapshot=dict(it.spec_snapshot or {}),
                        margin_lock=it.margin_lock,
                        manual_rate_override=it.manual_rate_override,
                    )
            return Response(
                self.get_serializer(clone).data, status=status.HTTP_201_CREATED
            )
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request, pk=None):
        quotation = self.get_object()
        via = (request.data or {}).get("via", "pdf_only")
        recipients = (request.data or {}).get("recipients") or []
        user = getattr(request, "user", None)
        # Guard: customer + at least one valid line required before send.
        if not quotation.customer_id and not (quotation.customer_name or "").strip():
            return Response(
                {"detail": "Pick a customer before sending the quotation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        items = list(quotation.items.all())
        if not items:
            return Response(
                {"detail": "Add at least one line before sending the quotation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        bad_lines = [
            it.line_name or str(it.id)
            for it in items
            if (it.qty_value or 0) <= 0 or (it.quoted_unit_price or 0) <= 0
        ]
        if bad_lines:
            return Response(
                {"detail": f"Lines have zero qty or price: {', '.join(bad_lines)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status == "DRAFT":
                    quotation.status = "SENT"
                quotation.sent_at = timezone.now()
                if user is not None and getattr(user, "is_authenticated", False):
                    quotation.sent_by = user
                quotation.save(update_fields=["status", "sent_at", "sent_by", "updated_at"])
                QuotationService.append_status_history(
                    quotation, status="SENT", user=user, note=f"Sent via {via}"
                )
                # Best-effort notification — outbound delivery is V2.
                try:
                    from apps.users.services.notification_service import NotificationService

                    NotificationService.create_notification(
                        user_ids=[],
                        title=f"Quotation {quotation.quote_number} sent",
                        body=(
                            f"Quote {quotation.quote_number} for "
                            f"{quotation.customer_name} sent via {via}."
                        ),
                        category="sales.quotation.sent",
                    )
                except Exception as exc:
                    logger.warning(
                        "quotation send notification failed for %s: %s",
                        quotation.quote_number,
                        exc,
                        exc_info=True,
                    )
            return Response(
                {
                    "id": str(quotation.id),
                    "status": quotation.status,
                    "sent_at": quotation.sent_at,
                    "via": via,
                    "recipients": recipients,
                }
            )
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        quotation = self.get_object()
        user = getattr(request, "user", None)
        # Guard: must be DRAFT or SENT with at least one priced line.
        items = list(quotation.items.all())
        if not items:
            return Response(
                {"detail": "Cannot approve an empty quotation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if any((it.qty_value or 0) <= 0 or (it.quoted_unit_price or 0) <= 0 for it in items):
            return Response(
                {"detail": "Every line needs qty > 0 and a unit price > 0 before approval."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status not in ("DRAFT", "SENT"):
                    return Response(
                        {"detail": f"Cannot approve a {quotation.status} quotation."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                quotation.status = "APPROVED"
                quotation.approved_at = timezone.now()
                if user is not None and getattr(user, "is_authenticated", False):
                    quotation.approved_by = user
                quotation.save(
                    update_fields=[
                        "status",
                        "approved_at",
                        "approved_by",
                        "updated_at",
                    ]
                )
                QuotationService.append_status_history(
                    quotation, status="APPROVED", user=user
                )
            return Response(
                {
                    "id": str(quotation.id),
                    "status": quotation.status,
                    "approved_at": quotation.approved_at,
                }
            )
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        quotation = self.get_object()
        user = getattr(request, "user", None)
        reason = str((request.data or {}).get("reason") or "").strip()
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status in ("CONVERTED",):
                    return Response(
                        {"detail": "Cannot reject a converted quotation."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                quotation.status = "REJECTED"
                quotation.rejection_reason = reason
                if user is not None and getattr(user, "is_authenticated", False):
                    quotation.rejected_by = user
                quotation.save(
                    update_fields=["status", "rejection_reason", "rejected_by", "updated_at"]
                )
                QuotationService.append_status_history(
                    quotation, status="REJECTED", user=user, note=reason
                )
            return Response(
                {"id": str(quotation.id), "status": quotation.status, "rejection_reason": reason}
            )
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=True, methods=["post"], url_path="expire")
    def expire(self, request, pk=None):
        quotation = self.get_object()
        user = getattr(request, "user", None)
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status in ("CONVERTED", "REJECTED"):
                    return Response(
                        {"detail": f"Cannot expire a {quotation.status} quotation."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                quotation.status = "EXPIRED"
                quotation.save(update_fields=["status", "updated_at"])
                QuotationService.append_status_history(
                    quotation, status="EXPIRED", user=user
                )
            return Response({"id": str(quotation.id), "status": quotation.status})
        except Exception as exc:
            return Response(
                {"detail": self._error_detail(exc)},
                status=self._error_status(exc),
            )

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        quotation = self.get_object()
        customer_view = str(request.query_params.get("customer_view") or "").lower() in ("1", "true", "yes")
        try:
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
        if quotation.status != "APPROVED":
            return Response(
                {"detail": "Only APPROVED quotations can be converted to a sales order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
                if quotation.status != "APPROVED":
                    return Response(
                        {"detail": "Only APPROVED quotations can be converted to a sales order."},
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
        if exc.__class__.__name__ == "ValidationError":
            return status.HTTP_400_BAD_REQUEST
        return status.HTTP_500_INTERNAL_SERVER_ERROR
