from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService

from ..models import (
    Quotation,
    QuotationAcceptance,
    QuotationApproval,
    QuotationAuditEvent,
)
from .quotation_cost_build import stable_checksum


def _actor(user):
    return user if getattr(user, "is_authenticated", False) else None


def _can(user, permission: str) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
        return True
    return can_with_wildcard(PermissionService.get_user_permissions(user), permission)


class QuotationLifecycleService:
    @classmethod
    def readiness_errors(cls, quotation: Quotation) -> list[str]:
        errors: list[str] = []
        if not quotation.customer_id:
            errors.append("Select an existing Customer Master.")
        if not quotation.plant_id:
            errors.append("Select a plant for source costs and delivery commitment.")
        if not quotation.contact_name.strip() or not quotation.contact_email.strip():
            errors.append("Customer contact name and email are required.")
        if not quotation.billing_address.strip() or not quotation.shipping_address.strip():
            errors.append("Frozen bill-to and ship-to addresses are required.")
        if not quotation.valid_until:
            errors.append("Quotation validity/expiry date is required.")
        elif quotation.valid_until < timezone.localdate():
            errors.append("Quotation validity date is already expired.")
        if not quotation.payment_terms.strip() or not quotation.delivery_terms.strip():
            errors.append("Payment and delivery terms are required.")
        if not quotation.terms.strip() and not quotation.custom_terms.strip():
            errors.append("Client quotation terms are required; no generic terms are assumed.")
        try:
            from apps.users.models import CompanyProfile
            company = CompanyProfile.get_solo()
            missing_company = [
                label for label, value in (
                    ("legal name", company.legal_name), ("address", company.address_line1),
                    ("email", company.email), ("GSTIN", company.gstin), ("PAN", company.pan),
                ) if not str(value or "").strip()
            ]
            if missing_company:
                errors.append(f"Company Profile is not client-ready: add {', '.join(missing_company)}.")
        except Exception:
            errors.append("Company Profile is unavailable for the client quotation.")
        items = list(quotation.items.select_related("product_master", "template").all())
        if not items:
            errors.append("Add at least one quotation line.")
        for item in items:
            label = item.line_name or str(item.id)
            if not item.product_master_id:
                errors.append(f"{label}: missing Base Product Master lineage.")
            if not item.template_id:
                errors.append(f"{label}: missing governed current LIVE template.")
            if not item.spec_signature or not item.canonical_source_snapshot:
                errors.append(f"{label}: canonical specification provenance is missing.")
            if item.qty_value <= 0 or item.quoted_unit_price <= 0 or item.quoted_line_total <= 0:
                errors.append(f"{label}: quantity, rate, and line total must be positive.")
            if item.line_kind == "AD_HOC":
                source = item.canonical_source_snapshot or {}
                if source.get("path") != "B_QUOTE_SCOPED_VARIANT" or source.get("master_mutation") is not False:
                    errors.append(f"{label}: quote-scoped variant lineage is invalid.")
                promotion = source.get("promotion") if isinstance(source.get("promotion"), dict) else {}
                promoted_variant_id = str(promotion.get("created_variant_id") or "")
                if item.product_master_size_id:
                    errors.append(f"{label}: quote-scoped configuration must not create or link a Size master.")
                if item.product_variant_id and (
                    not promotion.get("explicit")
                    or promoted_variant_id != str(item.product_variant_id)
                ):
                    errors.append(f"{label}: reusable variant linkage lacks an explicit audited save action.")
        try:
            cost = quotation.cost_build
        except Exception:
            errors.append("Complete and save Cost Build.")
        else:
            readiness = cost.readiness_snapshot if isinstance(cost.readiness_snapshot, dict) else {}
            if not readiness.get("ready"):
                cost_errors = readiness.get("errors") if isinstance(readiness.get("errors"), list) else []
                errors.extend([f"Cost Build: {message}" for message in cost_errors] or ["Cost Build is not commercially ready."])
            if cost.total_cost <= 0 or cost.net_sale <= 0 or not cost.checksum:
                errors.append("Cost Build totals/checksum are incomplete.")
            for component in cost.components.all():
                if component.readiness_status != "READY":
                    errors.append(f"Cost Build: {component.label} is {component.get_readiness_status_display().lower()}.")
                if component.effective_rate <= 0 or component.component_cost <= 0:
                    errors.append(f"Cost Build: {component.label} has a missing/zero authoritative cost.")
        return list(dict.fromkeys(errors))

    @classmethod
    @transaction.atomic
    def approve_cost_overrides(cls, quotation: Quotation, *, user, reason: str = "") -> Quotation:
        if not _can(user, "sales.quote.cost_override.approve"):
            raise ValidationError("You do not have permission to approve quote cost overrides.")
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "DRAFT":
            raise ValidationError("Cost overrides can only be approved on a draft revision.")
        try:
            cost = quotation.cost_build
        except Exception as exc:
            raise ValidationError("Save Cost Build before approving overrides.") from exc
        pending = list(cost.components.filter(override_status="PENDING"))
        if not pending:
            raise ValidationError("There are no pending quote cost overrides.")
        now = timezone.now()
        for component in pending:
            if component.override_by_id == getattr(user, "id", None):
                raise ValidationError("Override entry and approval must be performed by different users.")
            component.override_status = "APPROVED"
            component.override_approved_by = user
            component.override_approved_at = now
            component.readiness_status = "READY"
            component.save(update_fields=["override_status", "override_approved_by", "override_approved_at", "readiness_status", "updated_at"])
        readiness = deepcopy(cost.readiness_snapshot or {})
        prior_errors = readiness.get("errors") if isinstance(readiness.get("errors"), list) else []
        readiness["errors"] = [message for message in prior_errors if "override(s) require" not in str(message)]
        readiness["pending_override_count"] = 0
        readiness["ready"] = not readiness["errors"]
        cost.readiness_snapshot = readiness
        cost.checksum = stable_checksum({
            "previous": cost.checksum,
            "approved_components": [str(component.id) for component in pending],
            "approved_by": str(user.id),
            "approved_at": now.isoformat(),
        })
        cost.save(update_fields=["readiness_snapshot", "checksum", "updated_at"])
        QuotationAuditEvent.objects.create(
            quotation=quotation, event_type="COST_OVERRIDES_APPROVED", note=reason,
            after_snapshot={"component_ids": [str(component.id) for component in pending], "cost_checksum": cost.checksum}, actor=user,
        )
        return quotation

    @classmethod
    @transaction.atomic
    def submit(cls, quotation: Quotation, *, user) -> Quotation:
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "DRAFT":
            raise ValidationError("Only a draft revision can be submitted for approval.")
        errors = cls.readiness_errors(quotation)
        if errors:
            raise ValidationError({"readiness": errors})
        cost = quotation.cost_build
        now = timezone.now()
        frozen_payload = {
            "quotation_id": str(quotation.id), "quote_number": quotation.quote_number, "revision_no": quotation.revision_no,
            "header": {
                "customer_id": str(quotation.customer_id), "plant_id": str(quotation.plant_id), "currency": quotation.currency,
                "valid_until": quotation.valid_until.isoformat(), "contact_name": quotation.contact_name,
                "contact_email": quotation.contact_email, "billing_address": quotation.billing_address,
                "shipping_address": quotation.shipping_address, "payment_terms": quotation.payment_terms,
                "delivery_terms": quotation.delivery_terms, "tax_snapshot": deepcopy(quotation.tax_snapshot or {}),
            },
            "items": [
                {
                    "id": str(item.id), "line_kind": item.line_kind, "product_master_id": str(item.product_master_id),
                    "product_variant_id": str(item.product_variant_id or ""), "product_master_size_id": str(item.product_master_size_id or ""),
                    "canonical_source_snapshot": deepcopy(item.canonical_source_snapshot or {}), "spec_snapshot": deepcopy(item.spec_snapshot or {}),
                    "spec_signature": item.spec_signature, "qty_value": str(item.qty_value), "qty_uom": item.qty_uom,
                    "price_basis": item.price_basis, "quoted_unit_price": str(item.quoted_unit_price), "quoted_line_total": str(item.quoted_line_total),
                }
                for item in quotation.items.all()
            ],
            "cost_checksum": cost.checksum,
        }
        frozen_payload["checksum"] = stable_checksum(frozen_payload)
        cost.status = "FROZEN"
        cost.frozen_at = now
        cost.frozen_by = _actor(user)
        cost.checksum = stable_checksum({"cost_checksum": cost.checksum, "quote_snapshot_checksum": frozen_payload["checksum"]})
        cost.save(update_fields=["status", "frozen_at", "frozen_by", "checksum", "updated_at"])
        for item in quotation.items.all():
            item.cost_snapshot_checksum = cost.checksum
            item.save(update_fields=["cost_snapshot_checksum", "updated_at"])
        quotation.status = "PENDING_APPROVAL"
        quotation.frozen_at = now
        quotation.frozen_snapshot = frozen_payload
        quotation.save(update_fields=["status", "frozen_at", "frozen_snapshot", "updated_at"])
        gates = ("COMMERCIAL", "FINANCE")
        for gate in gates:
            QuotationApproval.objects.update_or_create(
                quotation=quotation, gate=gate,
                defaults={"status": "PENDING", "requested_by": _actor(user), "expires_at": now + timedelta(days=2), "snapshot_checksum": cost.checksum},
            )
        QuotationAuditEvent.objects.create(
            quotation=quotation, event_type="SUBMITTED_FOR_APPROVAL", actor=_actor(user),
            after_snapshot={"snapshot_checksum": frozen_payload["checksum"], "cost_checksum": cost.checksum, "gates": list(gates)},
        )
        return quotation

    @classmethod
    @transaction.atomic
    def approve_gate(cls, quotation: Quotation, *, gate: str, user, reason: str = "") -> Quotation:
        if not _can(user, "sales.quote.approve"):
            raise ValidationError("You do not have quotation approval permission.")
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "PENDING_APPROVAL":
            raise ValidationError("Only a pending quotation can be approved.")
        gate = str(gate or "COMMERCIAL").upper()
        approval = QuotationApproval.objects.select_for_update().filter(quotation=quotation, gate=gate).first()
        if not approval:
            raise ValidationError("This approval gate is not required for the quotation.")
        if approval.status != "PENDING":
            raise ValidationError(f"{gate} approval has already been decided.")
        if approval.requested_by_id == getattr(user, "id", None):
            raise ValidationError("The quotation submitter cannot approve the same revision.")
        if approval.expires_at and approval.expires_at <= timezone.now():
            raise ValidationError("Approval request expired; clone a fresh revision.")
        approval.status = "APPROVED"
        approval.reason = reason
        approval.decided_by = user
        approval.decided_at = timezone.now()
        approval.save(update_fields=["status", "reason", "decided_by", "decided_at"])
        if not quotation.approval_gates.filter(status="PENDING").exists():
            quotation.status = "APPROVED"
            quotation.approved_at = timezone.now()
            quotation.approved_by = user
            quotation.save(update_fields=["status", "approved_at", "approved_by", "updated_at"])
        QuotationAuditEvent.objects.create(
            quotation=quotation, event_type=f"{gate}_APPROVED", note=reason, actor=user,
            after_snapshot={"status": quotation.status, "snapshot_checksum": approval.snapshot_checksum},
        )
        return quotation

    @classmethod
    @transaction.atomic
    def reject_approval(cls, quotation: Quotation, *, gate: str, user, reason: str) -> Quotation:
        if not reason.strip():
            raise ValidationError("Approval rejection requires a reason.")
        if not _can(user, "sales.quote.approve"):
            raise ValidationError("You do not have quotation approval permission.")
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "PENDING_APPROVAL":
            raise ValidationError("Only a pending quotation can be rejected by an approver.")
        approval = QuotationApproval.objects.select_for_update().filter(quotation=quotation, gate=str(gate).upper()).first()
        if not approval or approval.status != "PENDING":
            raise ValidationError("Approval gate is missing or already decided.")
        approval.status = "REJECTED"
        approval.reason = reason.strip()
        approval.decided_by = user
        approval.decided_at = timezone.now()
        approval.save(update_fields=["status", "reason", "decided_by", "decided_at"])
        quotation.status = "REJECTED"
        quotation.rejection_reason = reason.strip()
        quotation.rejected_by = user
        quotation.save(update_fields=["status", "rejection_reason", "rejected_by", "updated_at"])
        QuotationAuditEvent.objects.create(quotation=quotation, event_type="APPROVAL_REJECTED", note=reason, actor=user, after_snapshot={"gate": approval.gate})
        return quotation

    @classmethod
    @transaction.atomic
    def record_client_outcome(cls, quotation: Quotation, *, outcome: str, reference: str, channel: str, reason: str, user) -> Quotation:
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status != "SENT":
            raise ValidationError("Client outcome can only be recorded for a delivered quotation revision.")
        outcome = str(outcome).upper()
        if outcome not in {"ACCEPTED", "REJECTED"}:
            raise ValidationError("Outcome must be ACCEPTED or REJECTED.")
        if outcome == "ACCEPTED" and not reference.strip():
            raise ValidationError("Customer acceptance reference is required.")
        if outcome == "REJECTED" and not reason.strip():
            raise ValidationError("Customer rejection reason is required.")
        now = timezone.now()
        QuotationAcceptance.objects.create(
            quotation=quotation, outcome=outcome, reference=reference.strip(), channel=channel.strip(), reason=reason.strip(),
            received_at=now, recorded_by=_actor(user), snapshot_checksum=quotation.cost_build.checksum,
        )
        quotation.status = outcome
        if outcome == "ACCEPTED":
            quotation.accepted_at = now
            quotation.accepted_by = _actor(user)
            quotation.acceptance_reference = reference.strip()
            quotation.acceptance_channel = channel.strip()
        else:
            quotation.rejection_reason = reason.strip()
            quotation.rejected_by = _actor(user)
        quotation.save()
        QuotationAuditEvent.objects.create(
            quotation=quotation, event_type=f"CLIENT_{outcome}", note=reason, actor=_actor(user),
            after_snapshot={"reference": reference, "channel": channel, "cost_checksum": quotation.cost_build.checksum},
        )
        return quotation

    @classmethod
    @transaction.atomic
    def cancel_or_void(cls, quotation: Quotation, *, action: str, reason: str, user) -> Quotation:
        if not reason.strip():
            raise ValidationError(f"{action.title()} requires a reason.")
        quotation = Quotation.objects.select_for_update().get(pk=quotation.pk)
        if quotation.status == "CONVERTED":
            raise ValidationError("A converted quotation cannot be cancelled or voided; use the Sales Order cancellation flow.")
        if quotation.status in {"CANCELLED", "VOID"}:
            raise ValidationError("Quotation is already cancelled or void.")
        now = timezone.now()
        action = action.upper()
        before = quotation.status
        if action == "CANCEL":
            quotation.status = "CANCELLED"
            quotation.cancellation_reason = reason.strip()
            quotation.cancelled_at = now
            quotation.cancelled_by = _actor(user)
        elif action == "VOID":
            quotation.status = "VOID"
            quotation.void_reason = reason.strip()
            quotation.voided_at = now
            quotation.voided_by = _actor(user)
        else:
            raise ValidationError("Action must be CANCEL or VOID.")
        quotation.save()
        QuotationAuditEvent.objects.create(
            quotation=quotation, event_type=quotation.status, note=reason, actor=_actor(user),
            before_snapshot={"status": before}, after_snapshot={"status": quotation.status},
        )
        return quotation
