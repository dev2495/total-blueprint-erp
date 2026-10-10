"""Outward gate evidence: watchman photographs papers leaving with goods; the
office matches each departure to the ERP documents it carried.

Never moves stock, never marks delivery or payment. A matched gate pass is the
only record whose state changes (ISSUED → OUT, NRGP → CLOSED) through its own
registered ``on_gate_out`` hook.

Search registry for other workstreams (job-work challans)::

    from apps.gate.outward_services import register_outward_search
    register_outward_search("JOBWORK_CHALLAN", search)   # see outward_registry

plus ``apps.gate.qr.register_qr_kind("JOBWORK_CHALLAN", resolve, on_gate_out)``.
"""
import uuid
from datetime import date, timedelta

from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.users.permission_service import PermissionService
from apps.users.services.bill_notifications import publish_document_event, register_document_event

from . import gate_pass_services, outward_resolvers  # noqa: F401  (registers QR kinds and searches)
from .document_pages import serialize_pages
from .image_pages import content_hash
from .models import OUTWARD_LINK_KINDS, GateAuditEvent, OutwardDocument, OutwardDocumentLink, OutwardDocumentPage
from .outward_registry import OUTWARD_SEARCHES, register_outward_search  # noqa: F401  (public re-export)
from .qr import QR_HANDLERS, parse_token
from .services import Conflict, date_bounds, gate_today, gate_zone, get_plant, idempotent_action, is_owner, is_watchman, scoped_plants

PENDING_EVENT = "documents.outward_pending"
register_document_event(PENDING_EVENT, "outward.reconcile")

KIND_LABELS = dict(OUTWARD_LINK_KINDS)
STATUS_LABELS = dict(OutwardDocument._meta.get_field("status").choices)
LIST_STATUSES = {"PENDING_MATCH", "DISCREPANCY", "MATCHED", "VOID", "OPEN", "ALL"}
MAX_CODES = 10


# --------------------------------------------------------------- permissions
def is_reconciler(user):
    return PermissionService.has_document_permission(user, "outward.reconcile")


def require_reconciler(user):
    if not is_reconciler(user):
        raise PermissionDenied("Matching outward gate photos is for the inventory team, administrators and owners.")


def _base_queryset():
    return OutwardDocument.objects.select_related("plant", "created_by", "matched_by").prefetch_related(
        Prefetch("pages", queryset=OutwardDocumentPage.objects.defer("data").order_by("page_number")),
        Prefetch("links", queryset=OutwardDocumentLink.objects.select_related("linked_by", "removed_by").order_by("linked_at", "id")),
    )


def outward_queryset(user):
    """Reconcilers: every factory. Watchman: own departures of today at assigned gates."""
    if is_reconciler(user):
        return _base_queryset().filter(plant__in=PermissionService.document_plants(user))
    if is_watchman(user):
        start, end = date_bounds(gate_today(), gate_today())
        return _base_queryset().filter(plant__in=scoped_plants(user), created_by=user, departed_at__gte=start, departed_at__lt=end)
    raise PermissionDenied("This account cannot open outward gate documents.")


def get_outward(user, pk):
    obj = outward_queryset(user).filter(id=pk).first()
    if not obj:
        raise NotFound("This outward record is unavailable.")
    return obj


# ------------------------------------------------------------------ payloads
def _name(user):
    if not user:
        return ""
    return user.get_full_name() or user.username


def _page_url(document):
    return lambda page: f"/api/gate/outward-documents/{document.id}/pages/{page.id}/"


def link_payload(link, *, watchman=False):
    snapshot = link.snapshot or {}
    data = {
        "id": str(link.id),
        "kind": link.kind,
        "kind_label": KIND_LABELS.get(link.kind, link.kind),
        "reference": link.reference or snapshot.get("reference", ""),
        "party_name": snapshot.get("party_name", ""),
    }
    if watchman:
        return data
    return {
        **data,
        "object_id": str(link.object_id) if link.object_id else None,
        "summary": snapshot.get("summary", ""),
        "snapshot": snapshot,
        "link_source": link.link_source,
        "linked_at": link.linked_at.isoformat(),
        "linked_by_name": _name(link.linked_by),
        "active": link.removed_at is None,
        "removed_at": link.removed_at.isoformat() if link.removed_at else None,
        "removed_by_name": _name(link.removed_by),
        "removed_reason": link.removed_reason,
    }


def _scanned_payload(refs, watchman):
    rows = []
    for row in refs or []:
        item = {"status": row.get("status"), "kind": row.get("kind"), "kind_label": KIND_LABELS.get(row.get("kind"), ""), "reference": row.get("reference", ""), "error": row.get("error", "")}
        if not watchman:
            item["code"] = row.get("code", "")
            item["object_id"] = row.get("object_id")
        rows.append(item)
    return rows


def other_departures(kind, object_id, exclude_document_id):
    """Other non-void departures that carried the same ERP record (multi-trip warning)."""
    if not object_id:
        return []
    links = (
        OutwardDocumentLink.objects.filter(kind=kind, object_id=object_id, removed_at__isnull=True)
        .exclude(document_id=exclude_document_id).exclude(document__status="VOID")
        .select_related("document__plant").order_by("document__departed_at")
    )
    return [
        {"document_id": str(link.document_id), "departed_at": link.document.departed_at.isoformat(), "vehicle_number": link.document.vehicle_number, "plant_name": link.document.plant.name, "status": link.document.status}
        for link in links[:20]
    ]


def outward_payload(document, user=None, *, detail=False):
    watchman = user is not None and is_watchman(user)
    pages = serialize_pages("OUTWARD", document.pages.all(), _page_url(document))
    links = list(document.links.all())
    active = [link for link in links if link.removed_at is None]
    data = {
        "id": str(document.id),
        "reference": str(document.id)[:8].upper(),
        "plant": str(document.plant_id),
        "plant_name": document.plant.name,
        "departed_at": document.departed_at.isoformat(),
        "status": document.status,
        "status_label": STATUS_LABELS.get(document.status, document.status),
        "vehicle_number": document.vehicle_number,
        "created_by_name": _name(document.created_by),
        "page_count": len(pages),
        "pages": pages,
        "links": [link_payload(link, watchman=watchman) for link in active],
        "link_count": len(active),
        "scanned_refs": _scanned_payload(document.scanned_refs, watchman),
    }
    if watchman:
        return data
    data.update({
        "notes": document.notes,
        "matched_at": document.matched_at.isoformat() if document.matched_at else None,
        "matched_by_name": _name(document.matched_by),
        "resolution_reason": document.resolution_reason,
        "discrepancies": document.discrepancies or [],
        "content_hash": document.content_hash,
    })
    if detail:
        data["removed_links"] = [link_payload(link) for link in links if link.removed_at is not None]
        for row, link in zip(data["links"], active):
            row["other_departures"] = other_departures(link.kind, link.object_id, document.id)
        events = GateAuditEvent.objects.filter(object_type="OUTWARD", object_id=document.id).select_related("actor").order_by("created_at", "id")
        data["timeline"] = [{"id": str(event.id), "action": event.action, "actor_name": _name(event.actor) or "System", "reason": event.reason, "created_at": event.created_at.isoformat()} for event in events]
        void = next((event for event in reversed(data["timeline"]) if event["action"] == "OUTWARD_VOIDED"), None)
        data["voided_at"] = void["created_at"] if void else None
        data["voided_by_name"] = void["actor_name"] if void else ""
        data["duplicate_photos"] = [
            {"document_id": str(row.id), "departed_at": row.departed_at.isoformat(), "status": row.status}
            for row in OutwardDocument.objects.filter(plant_id=document.plant_id, content_hash=document.content_hash).exclude(id=document.id).order_by("-departed_at")[:10]
        ]
        data["can_void"] = is_owner(user) if user is not None else False
    return data


def current_actor_payload(payload, user):
    """Re-apply watchman redaction to a cached idempotent response."""
    if not is_watchman(user):
        return payload
    keep = {"id", "reference", "plant", "plant_name", "departed_at", "status", "status_label", "vehicle_number", "created_by_name", "page_count", "pages", "link_count", "replayed"}
    data = {key: value for key, value in payload.items() if key in keep}
    data["links"] = [{key: row.get(key, "") for key in ["id", "kind", "kind_label", "reference", "party_name"]} for row in payload.get("links", [])]
    data["scanned_refs"] = [{key: row.get(key, "") for key in ["status", "kind", "kind_label", "reference", "error"]} for row in payload.get("scanned_refs", [])]
    return data


def safe_snapshot(document):
    links = list(document.links.all())
    return {
        "status": document.status,
        "departed_at": document.departed_at.isoformat(),
        "vehicle_number": document.vehicle_number,
        "page_count": document.pages.count(),
        "links": [{"id": str(link.id), "kind": link.kind, "object_id": str(link.object_id) if link.object_id else None, "reference": link.reference, "active": link.removed_at is None} for link in links],
        "scanned_codes": len(document.scanned_refs or []),
        "matched_at": document.matched_at.isoformat() if document.matched_at else None,
        "discrepancy_count": len(document.discrepancies or []),
    }


def outward_audit(document, action, actor, reason="", before=None):
    GateAuditEvent.objects.create(plant_id=document.plant_id, object_id=document.id, object_type="OUTWARD", action=action, actor=actor, reason=reason[:500], before=before or {}, after=safe_snapshot(document))


# ------------------------------------------------------------------- linking
def resolve_link(kind, object_id, plant):
    handler = QR_HANDLERS.get(kind)
    if handler is None:
        raise ValidationError({"kind": f"{KIND_LABELS.get(kind, kind)} documents cannot be matched yet."})
    return handler["resolve"](object_id, plant)


def _gate_out(kind, object_id, departed_at, user):
    handler = QR_HANDLERS.get(kind) or {}
    hook = handler.get("on_gate_out")
    if hook is not None:
        hook(object_id, departed_at, user)


def _undo_gate_out(link, user, reason):
    if link.kind == "GATE_PASS" and link.object_id:
        gate_pass_services.revert_gate_out(link.object_id, user, reason)


def _error_text(error):
    detail = getattr(error, "detail", error)
    if isinstance(detail, dict):
        detail = next(iter(detail.values()), "")
    if isinstance(detail, list):
        detail = detail[0] if detail else ""
    return str(detail)[:300]


def _create_link(document, kind, object_id, snapshot, user, source):
    return OutwardDocumentLink.objects.create(
        document=document, kind=kind, object_id=object_id, reference=str(snapshot.get("reference") or "")[:120],
        snapshot=snapshot, link_source=source, linked_by=user,
    )


# ------------------------------------------------------------------- capture
def capture_outward(user, data):
    """Watchman (assigned gate) or Owner/Admin records a departure with photos."""
    if not (is_watchman(user) or is_owner(user)):
        raise PermissionDenied("Only gate staff can record goods leaving the factory.")
    plant = get_plant(user, data["plant"])
    pages = data["images"]
    codes = data.get("scanned_codes") or []

    def operation():
        departed_at = timezone.now()
        document = OutwardDocument.objects.create(plant=plant, created_by=user, departed_at=departed_at, content_hash=content_hash(pages), vehicle_number=data.get("vehicle_number") or "")
        OutwardDocumentPage.objects.bulk_create([OutwardDocumentPage(document=document, page_number=index + 1, **page) for index, page in enumerate(pages)])
        refs, linked, invalid, warned = [], [], 0, False
        seen = set()
        for raw in codes:
            row = {"code": raw[:200]}
            try:
                kind, object_id = parse_token(raw)
                row.update({"kind": kind, "object_id": str(object_id)})
                if (kind, object_id) in seen:
                    row.update({"status": "DUPLICATE_SCAN", "reference": next((ref.get("reference", "") for ref in refs if ref.get("object_id") == str(object_id)), "")})
                    refs.append(row)
                    continue
                snapshot = resolve_link(kind, object_id, plant)
                link = _create_link(document, kind, object_id, snapshot, user, "QR")
                linked.append(link)
                seen.add((kind, object_id))
                warned = warned or bool(snapshot.get("warnings"))
                row.update({"status": "LINKED", "reference": link.reference, "link_id": str(link.id)})
            except ValidationError as error:
                invalid += 1
                row.update({"status": "INVALID", "error": _error_text(error)})
            refs.append(row)
        document.scanned_refs = refs
        if linked and not invalid and not warned:
            document.status, document.matched_at, document.matched_by = "MATCHED", departed_at, user
            document.resolution_reason = "Matched by QR scan at the gate."
        document.save(update_fields=["scanned_refs", "status", "matched_at", "matched_by", "resolution_reason"])
        for link in linked:
            _gate_out(link.kind, link.object_id, departed_at, user)
        outward_audit(document, "OUTWARD_RECORDED", user, f"{len(pages)} page(s), {len(linked)} QR match(es), {invalid} unrecognised code(s).")
        if document.status == "PENDING_MATCH":
            local = departed_at.astimezone(gate_zone())
            vehicle = f" in {document.vehicle_number}" if document.vehicle_number else ""
            publish_document_event(
                event_key=PENDING_EVENT, plant=plant, object_id=document.id, object_type="OutwardDocument",
                title=f"Outward photo to match · {plant.name}",
                message=f"{len(pages)} page{'' if len(pages) == 1 else 's'} left the gate at {local:%I:%M %p}{vehicle}. Match it to the ERP document.",
                deep_link=f"/inventory/outward-documents/{document.id}", priority="NORMAL",
            )
        document = _base_queryset().get(id=document.id)
        return outward_payload(document, user)

    safe_data = {
        "client_token": data["client_token"], "plant": data["plant"], "vehicle_number": data.get("vehicle_number") or "",
        "scanned_codes": list(codes), "images": [{key: page[key] for key in ["sha256", "width", "height", "byte_size"]} for page in pages],
    }
    return current_actor_payload(idempotent_action(plant, f"outward:capture:{user.id}", safe_data, operation), user)


# ------------------------------------------------------------- office actions
def _locked(document):
    current = OutwardDocument.objects.select_for_update().get(id=document.id)
    if current.status == "VOID":
        raise Conflict("This outward record is voided. Refresh the queue.")
    return current


def _respond(document, user):
    return outward_payload(_base_queryset().get(id=document.id), user, detail=True)


def link_document(user, document, data):
    require_reconciler(user)

    def operation():
        current = _locked(document)
        before = safe_snapshot(current)
        kind = data["kind"]
        if kind == "OTHER":
            reference = data["reference"].strip()
            if current.links.filter(kind="OTHER", reference__iexact=reference, removed_at__isnull=True).exists():
                raise Conflict("This reference is already linked to the departure.")
            snapshot = {"kind": "OTHER", "id": None, "reference": reference, "party_name": (data.get("party_name") or "").strip(), "plant": str(current.plant_id), "plant_name": current.plant.name, "status": "", "document_date": None, "lines": [], "line_count": 0, "summary": (data.get("reason") or "").strip(), "warnings": []}
            link = _create_link(current, "OTHER", None, snapshot, user, "MANUAL")
        else:
            object_id = data["object_id"]
            if current.links.filter(kind=kind, object_id=object_id, removed_at__isnull=True).exists():
                raise Conflict("This document is already linked to the departure.")
            snapshot = resolve_link(kind, object_id, current.plant)
            link = _create_link(current, kind, object_id, snapshot, user, "MANUAL")
            _gate_out(kind, object_id, current.departed_at, user)
        outward_audit(current, "OUTWARD_LINKED", user, (data.get("reason") or f"Linked {KIND_LABELS.get(kind, kind).lower()} {link.reference}.").strip(), before)
        payload = _respond(current, user)
        payload["link_warnings"] = other_departures(kind, link.object_id, current.id) if link.object_id else []
        return payload

    return idempotent_action(document.plant, f"outward:{document.id}:link:{user.id}", data, operation)


def unlink_document(user, document, data):
    require_reconciler(user)

    def operation():
        current = _locked(document)
        before = safe_snapshot(current)
        link = current.links.filter(id=data["link_id"]).first()
        if link is None:
            raise ValidationError({"link_id": "Choose a link of this departure."})
        if link.removed_at is not None:
            raise Conflict("This link was already removed.")
        link.removed_at, link.removed_by, link.removed_reason = timezone.now(), user, data["reason"]
        link.save(update_fields=["removed_at", "removed_by", "removed_reason"])
        if current.status == "MATCHED" and not current.links.filter(removed_at__isnull=True).exists():
            current.status, current.matched_at, current.matched_by = "PENDING_MATCH", None, None
            current.resolution_reason = ""
            current.save(update_fields=["status", "matched_at", "matched_by", "resolution_reason"])
        _undo_gate_out(link, user, f"Outward link removed: {data['reason']}")
        outward_audit(current, "OUTWARD_UNLINKED", user, data["reason"], before)
        return _respond(current, user)

    return idempotent_action(document.plant, f"outward:{document.id}:unlink:{user.id}", data, operation)


def mark_discrepancy(user, document, data):
    require_reconciler(user)

    def operation():
        current = _locked(document)
        before = safe_snapshot(current)
        current.discrepancies = [*(current.discrepancies or []), {"notes": data["notes"], "by": _name(user), "at": timezone.now().isoformat()}]
        current.status, current.matched_at, current.matched_by = "DISCREPANCY", None, None
        current.save(update_fields=["discrepancies", "status", "matched_at", "matched_by"])
        outward_audit(current, "OUTWARD_DISCREPANCY", user, data["notes"], before)
        return _respond(current, user)

    return idempotent_action(document.plant, f"outward:{document.id}:discrepancy:{user.id}", data, operation)


def resolve_matched(user, document, data):
    require_reconciler(user)

    def operation():
        current = _locked(document)
        if current.status == "MATCHED":
            raise Conflict("This departure is already matched.")
        if not current.links.filter(removed_at__isnull=True).exists():
            raise ValidationError({"links": "Link at least one ERP document before marking the departure matched."})
        before = safe_snapshot(current)
        reason = (data.get("reason") or "").strip() or "Office confirmed the documents that left."
        current.status, current.matched_at, current.matched_by, current.resolution_reason = "MATCHED", timezone.now(), user, reason
        current.save(update_fields=["status", "matched_at", "matched_by", "resolution_reason"])
        outward_audit(current, "OUTWARD_MATCHED", user, reason, before)
        return _respond(current, user)

    return idempotent_action(document.plant, f"outward:{document.id}:resolve:{user.id}", data, operation)


def void_document(user, document, data):
    if not is_owner(user):
        raise PermissionDenied("Only an owner or administrator can void an outward record.")

    def operation():
        current = _locked(document)
        before = safe_snapshot(current)
        now = timezone.now()
        removed = []
        for link in current.links.filter(removed_at__isnull=True):
            link.removed_at, link.removed_by, link.removed_reason = now, user, f"Departure voided: {data['reason']}"[:500]
            link.save(update_fields=["removed_at", "removed_by", "removed_reason"])
            removed.append(link)
        current.status, current.matched_at, current.matched_by, current.resolution_reason = "VOID", None, None, data["reason"]
        current.save(update_fields=["status", "matched_at", "matched_by", "resolution_reason"])
        for link in removed:
            _undo_gate_out(link, user, f"Outward record voided: {data['reason']}")
        outward_audit(current, "OUTWARD_VOIDED", user, data["reason"], before)
        return _respond(current, user)

    return idempotent_action(document.plant, f"outward:{document.id}:void:{user.id}", data, operation)


# ----------------------------------------------------------------- candidates
def candidates(user, document, query="", kind=None):
    require_reconciler(user)
    query = str(query or "").strip()[:100]
    kinds = [kind] if kind else sorted(OUTWARD_SEARCHES)
    if kind and kind not in OUTWARD_SEARCHES:
        raise ValidationError({"kind": "Choose a document type that can be searched."})
    active = {(link.kind, str(link.object_id)) for link in document.links.all() if link.removed_at is None and link.object_id}
    rows = []
    for name in kinds:
        for snapshot in OUTWARD_SEARCHES[name](document.plant, query, around=document.departed_at, limit=10 if not kind else 25):
            snapshot = dict(snapshot)
            snapshot["kind_label"] = KIND_LABELS.get(snapshot.get("kind"), snapshot.get("kind"))
            snapshot["linked_here"] = (snapshot.get("kind"), str(snapshot.get("id"))) in active
            snapshot["other_departures"] = other_departures(snapshot.get("kind"), snapshot.get("id"), document.id)
            rows.append(snapshot)
    return {"results": rows, "kinds": [{"value": name, "label": KIND_LABELS.get(name, name)} for name in sorted(OUTWARD_SEARCHES)], "query": query}


# ---------------------------------------------------------------- list views
def _period(params):
    try:
        start = date.fromisoformat(params.get("date_from") or str(gate_today() - timedelta(days=365)))
        end = date.fromisoformat(params.get("date_to") or str(gate_today()))
    except ValueError:
        raise ValidationError({"date_from": "Use dates in YYYY-MM-DD format."})
    if start > end or (end - start).days > 366:
        raise ValidationError({"date_from": "Choose an ordered date range of 366 days or fewer."})
    return start, end


def list_filters(source, params):
    """Reconciler filters (status, plant, dates, search, has_links) + per-status counts."""
    plant = params.get("plant")
    if plant:
        try:
            source = source.filter(plant_id=uuid.UUID(str(plant)))
        except ValueError:
            raise ValidationError({"plant": "Use a valid reference."})
    if params.get("date_from") or params.get("date_to"):
        start, end = date_bounds(*_period(params))
        source = source.filter(departed_at__gte=start, departed_at__lt=end)
    search = str(params.get("search") or "").strip()[:100]
    if search:
        normalised = "".join(ch for ch in search.upper() if ch.isalnum())
        matching = OutwardDocumentLink.objects.filter(removed_at__isnull=True).filter(Q(reference__icontains=search) | Q(snapshot__party_name__icontains=search)).values("document_id")
        predicate = Q(id__in=matching) | Q(created_by__username__icontains=search)
        if normalised:
            predicate |= Q(vehicle_number__icontains=normalised)
        source = source.filter(predicate)
    has_links = params.get("has_links")
    if has_links not in (None, ""):
        if has_links not in {"true", "false"}:
            raise ValidationError({"has_links": "Use true or false."})
        source = source.annotate(_linked=Exists(OutwardDocumentLink.objects.filter(document=OuterRef("pk"), removed_at__isnull=True))).filter(_linked=has_links == "true")
    counts = {row["status"]: row["n"] for row in source.prefetch_related(None).order_by().values("status").annotate(n=Count("id"))}
    counts = {status: counts.get(status, 0) for status in ["PENDING_MATCH", "DISCREPANCY", "MATCHED", "VOID"]}
    counts["OPEN"] = counts["PENDING_MATCH"] + counts["DISCREPANCY"]
    counts["ALL"] = sum(counts[status] for status in ["PENDING_MATCH", "DISCREPANCY", "MATCHED", "VOID"])
    status = params.get("status") or "ALL"
    if status not in LIST_STATUSES:
        raise ValidationError({"status": "Choose a valid outward status."})
    if status == "OPEN":
        source = source.filter(status__in=["PENDING_MATCH", "DISCREPANCY"]).order_by("departed_at", "id")
    elif status in {"PENDING_MATCH", "DISCREPANCY"}:
        source = source.filter(status=status).order_by("departed_at", "id")
    elif status != "ALL":
        source = source.filter(status=status)
    return source, counts


def recent_vehicles(plant_id, days=3, limit=8):
    since = timezone.now() - timedelta(days=days)
    seen, rows = set(), []
    for value in OutwardDocument.objects.filter(plant_id=plant_id, departed_at__gte=since).exclude(vehicle_number="").order_by("-departed_at").values_list("vehicle_number", flat=True)[:200]:
        if value not in seen:
            seen.add(value)
            rows.append(value)
        if len(rows) >= limit:
            break
    return rows
