from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.tooling.services import CylinderService

from .models import Artwork
from .serializers import ArtworkSerializer


def _to_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return int(default)


def _to_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y"}:
        return True
    if text in {"0", "false", "no", "n"}:
        return False
    return None


def _cylinder_slots_ready(artwork: Artwork) -> bool:
    front_required = int(artwork.front_colors_count or 0)
    back_required = int(artwork.back_colors_count or 0)
    if front_required + back_required <= 0:
        return False
    front_slots = set()
    back_slots = set()
    for assignment in artwork.cylinder_slot_assignments.all():
        cyl = getattr(assignment, "cylinder", None)
        if cyl is None or cyl.is_draft:
            continue
        side = str(assignment.side or "FRONT").upper()
        slot = int(assignment.side_slot_index or 0)
        if slot <= 0:
            continue
        if side == "BACK":
            back_slots.add(slot)
        else:
            front_slots.add(slot)
    for cyl in artwork.cylinders.all():
        if cyl.is_draft:
            continue
        side = str(cyl.side or "FRONT").upper()
        slot = int(cyl.side_slot_index or 0)
        if slot <= 0:
            continue
        if side == "BACK":
            back_slots.add(slot)
        else:
            front_slots.add(slot)
    return len(front_slots) >= front_required and len(back_slots) >= back_required


def _collect_error_details(exc):
    checklist = []
    if hasattr(exc, "message_dict") and isinstance(getattr(exc, "message_dict"), dict):
        for field, rows in exc.message_dict.items():
            values = rows if isinstance(rows, (list, tuple)) else [rows]
            for row in values:
                text = str(row).strip()
                if text:
                    checklist.append({"field": str(field), "detail": text})
    elif hasattr(exc, "messages") and isinstance(getattr(exc, "messages"), (list, tuple)):
        for row in exc.messages:
            text = str(row).strip()
            if text:
                checklist.append({"detail": text})
    return checklist


class ArtworkViewSet(viewsets.ModelViewSet):
    serializer_class = ArtworkSerializer
    filterset_fields = ["status", "print_type", "substrate_mode"]
    search_fields = ["design_code", "name"]
    pagination_class = None

    def get_queryset(self):
        qs = Artwork.objects.all().prefetch_related("images", "cylinders", "cylinder_slot_assignments__cylinder").order_by("-created_at")
        params = self.request.query_params

        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status=str(status_param).upper())

        print_type = params.get("print_type")
        if print_type:
            qs = qs.filter(print_type=str(print_type).upper())
        substrate_mode = params.get("substrate_mode") or params.get("film_type")
        if substrate_mode:
            qs = qs.filter(substrate_mode=str(substrate_mode).upper())

        front_count = params.get("front_colors_count")
        back_count = params.get("back_colors_count")
        if front_count is not None:
            qs = qs.filter(front_colors_count=_to_int(front_count, 0))
        if back_count is not None:
            qs = qs.filter(back_colors_count=_to_int(back_count, 0))

        cylinder_ready = _to_bool(params.get("cylinder_ready"))
        exclude_cylinder_artwork = _to_bool(params.get("exclude_cylinder_artwork"))
        if cylinder_ready is not None or exclude_cylinder_artwork:
            rows = list(qs)
            if cylinder_ready is True:
                rows = [row for row in rows if _cylinder_slots_ready(row)]
            elif cylinder_ready is False:
                rows = [
                    row
                    for row in rows
                    if row.cylinders.filter(is_draft=False).count() == 0
                    and row.cylinder_slot_assignments.filter(cylinder__is_draft=False).count() == 0
                ]
            if exclude_cylinder_artwork:
                rows = [
                    row
                    for row in rows
                    if row.cylinders.filter(is_draft=False).count() == 0
                    and row.cylinder_slot_assignments.filter(cylinder__is_draft=False).count() == 0
                ]
            row_ids = [row.id for row in rows]
            qs = Artwork.objects.filter(id__in=row_ids).prefetch_related("images", "cylinders", "cylinder_slot_assignments__cylinder").order_by("-created_at")

        return qs

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        from .services import ArtworkService

        try:
            artwork = ArtworkService.approve_artwork(pk, request.user)
            return Response({"status": "approved", "id": artwork.id})
        except Exception as exc:
            checklist = _collect_error_details(exc)
            message = checklist[0]["detail"] if checklist else str(exc)
            return Response(
                {
                    "error": {
                        "code": "ARTWORK_APPROVAL_BLOCKED",
                        "message": message,
                        "checklist": checklist,
                    }
                },
                status=400,
            )

    @action(detail=True, methods=["post"], url_path="generate-cylinders")
    def generate_cylinders(self, request, pk=None):
        force = bool(request.data.get("force", False))
        targets = request.data.get("targets")
        if targets is None and (request.data.get("side") or request.data.get("slot") or request.data.get("side_slot_index")):
            targets = [
                {
                    "side": request.data.get("side"),
                    "slot": request.data.get("slot") or request.data.get("side_slot_index"),
                }
            ]
        try:
            result = CylinderService.generate_for_artwork(pk, force=force, targets=targets)
            created_rows = result.get("created", [])
            existing_draft = result.get("existing_draft", [])
            existing_finalized = result.get("existing_finalized", [])
            return Response(
                {
                    "status": "generated",
                    "artwork_id": str(pk),
                    "count": len(created_rows),
                    "cylinders": [str(c.id) for c in created_rows],
                    "existing_draft_count": len(existing_draft),
                    "existing_finalized_count": len(existing_finalized),
                    "existing_draft": existing_draft,
                    "existing_finalized": existing_finalized,
                    "existing_assigned": result.get("existing_assigned", []),
                }
            )
        except Exception as exc:
            checklist = _collect_error_details(exc)
            message = checklist[0]["detail"] if checklist else str(exc)
            return Response(
                {
                    "error": {
                        "code": "CYLINDER_GENERATION_FAILED",
                        "message": message,
                        "checklist": checklist,
                    }
                },
                status=400,
            )
