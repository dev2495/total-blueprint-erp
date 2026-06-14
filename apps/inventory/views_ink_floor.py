from decimal import Decimal

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.inventory.models import InkFloorMovement, InkFloorSession
from apps.inventory.serializers_ink_floor import InkFloorMovementSerializer, InkFloorSessionSerializer
from apps.inventory.services.ink_floor import InkFloorService


def _api_error(exc):
    detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
    return {"detail": detail}


def _dt(value, default=None):
    if not value:
        return default
    parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValidationError("Use ISO datetime format.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


class InkFloorMovementListView(generics.ListAPIView):
    serializer_class = InkFloorMovementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = (
            InkFloorMovement.objects.select_related(
                "plant",
                "material",
                "target_material",
                "source_location",
                "destination_location",
                "session",
            )
            .all()
            .order_by("-event_at", "-created_at")
        )
        params = self.request.query_params
        if params.get("plant"):
            qs = qs.filter(plant_id=params.get("plant"))
        if params.get("material"):
            qs = qs.filter(material_id=params.get("material"))
        if params.get("type"):
            qs = qs.filter(type=str(params.get("type")).strip().upper())
        if params.get("location"):
            location_id = params.get("location")
            qs = qs.filter(source_location_id=location_id) | qs.filter(destination_location_id=location_id)
        if params.get("start_at"):
            qs = qs.filter(event_at__gte=_dt(params.get("start_at")))
        if params.get("end_at"):
            qs = qs.filter(event_at__lte=_dt(params.get("end_at")))
        return qs[:500]


class InkFloorSessionListView(generics.ListAPIView):
    serializer_class = InkFloorSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = (
            InkFloorSession.objects.select_related("plant", "location")
            .prefetch_related("count_lines", "count_lines__material")
            .all()
            .order_by("-opened_at", "-created_at")
        )
        params = self.request.query_params
        if params.get("plant"):
            qs = qs.filter(plant_id=params.get("plant"))
        if params.get("location"):
            qs = qs.filter(location_id=params.get("location"))
        if params.get("status"):
            qs = qs.filter(status=str(params.get("status")).strip().upper())
        if params.get("shift_date"):
            qs = qs.filter(shift_date=params.get("shift_date"))
        if params.get("count_start_at"):
            qs = qs.filter(counted_at__gte=_dt(params.get("count_start_at")))
        if params.get("count_end_at"):
            qs = qs.filter(counted_at__lte=_dt(params.get("count_end_at")))
        return qs[:200]


class InkFloorIssueView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            movement = InkFloorService.issue_to_floor(
                material_id=request.data.get("material_id"),
                qty_kg=Decimal(str(request.data.get("qty_kg") or 0)),
                from_location_id=request.data.get("from_location_id"),
                floor_location_id=request.data.get("floor_location_id") or request.data.get("to_location_id"),
                event_at=_dt(request.data.get("event_at"), timezone.now()),
                reference=request.data.get("reference") or "",
                notes=request.data.get("notes") or "",
                user=request.user,
            )
            return Response(InkFloorMovementSerializer(movement).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response(_api_error(exc), status=400)


class InkFloorReturnView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            movement = InkFloorService.return_from_floor(
                material_id=request.data.get("material_id"),
                qty_kg=Decimal(str(request.data.get("qty_kg") or 0)),
                floor_location_id=request.data.get("floor_location_id") or request.data.get("from_location_id"),
                to_location_id=request.data.get("to_location_id"),
                event_at=_dt(request.data.get("event_at"), timezone.now()),
                reference=request.data.get("reference") or "",
                notes=request.data.get("notes") or "",
                user=request.user,
            )
            return Response(InkFloorMovementSerializer(movement).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response(_api_error(exc), status=400)


class InkFloorMixReturnView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            movement = InkFloorService.mix_return(
                source_material_id=request.data.get("source_material_id") or request.data.get("material_id"),
                target_material_id=request.data.get("target_material_id") or None,
                target_base_type=request.data.get("target_base_type") or "",
                target_color_name=request.data.get("target_color_name") or "",
                qty_kg=Decimal(str(request.data.get("qty_kg") or 0)),
                floor_location_id=request.data.get("floor_location_id") or request.data.get("from_location_id"),
                to_location_id=request.data.get("to_location_id"),
                event_at=_dt(request.data.get("event_at"), timezone.now()),
                reference=request.data.get("reference") or "",
                notes=request.data.get("notes") or "",
                user=request.user,
            )
            return Response(InkFloorMovementSerializer(movement).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response(_api_error(exc), status=400)


class InkFloorCountView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            session = InkFloorService.post_count(
                plant_id=request.data.get("plant_id") or request.data.get("plant"),
                location_id=request.data.get("location_id") or request.data.get("location"),
                opened_at=_dt(request.data.get("opened_at"), None),
                counted_at=_dt(request.data.get("counted_at") or request.data.get("event_at"), timezone.now()),
                reference=request.data.get("reference") or "",
                notes=request.data.get("notes") or "",
                lines=request.data.get("lines") or [],
                user=request.user,
            )
            return Response(InkFloorSessionSerializer(session).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response(_api_error(exc), status=400)


class InkFloorReconcileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            end_at = _dt(request.query_params.get("end_at"), timezone.now())
            start_at = _dt(request.query_params.get("start_at"), end_at.replace(hour=0, minute=0, second=0, microsecond=0))
            payload = InkFloorService.reconcile(
                plant_id=request.query_params.get("plant") or request.query_params.get("plant_id"),
                location_id=request.query_params.get("location") or request.query_params.get("location_id"),
                start_at=start_at,
                end_at=end_at,
            )
            return Response(payload)
        except Exception as exc:
            return Response(_api_error(exc), status=400)
