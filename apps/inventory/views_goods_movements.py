"""GET /api/inventory/goods-movements/ — the Goods in & out register (read only).

Query: stage (PREPARED|OUTSIDE|AT_GATE|DONE), kind (INTERPLANT|JOBWORK|RGP|NRGP), plant, q,
overdue=1, page, page_size. Every account that may view stock reads it (route map: inventory.view).
"""
import uuid

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.permissions import RoleBasedAccessPermission

from .services.goods_movements import KINDS, STAGES, movement_register


class GoodsMovementRegisterView(APIView):
    permission_classes = [IsAuthenticated, RoleBasedAccessPermission]

    def get(self, request):
        params = request.query_params
        plant = str(params.get("plant") or "").strip()
        plant_ids = None
        if plant:
            try:
                plant_ids = [uuid.UUID(plant)]
            except ValueError as exc:
                raise ValidationError({"plant": "Use a valid factory."}) from exc
        stage = str(params.get("stage") or "").upper()
        kind = str(params.get("kind") or "").upper()
        if stage and stage not in STAGES:
            raise ValidationError({"stage": f"Choose one of {', '.join(STAGES)}."})
        if kind and kind not in KINDS:
            raise ValidationError({"kind": f"Choose one of {', '.join(KINDS)}."})
        try:
            page = int(params.get("page") or 1)
            page_size = int(params.get("page_size") or 50)
        except ValueError as exc:
            raise ValidationError({"page": "Use whole numbers for paging."}) from exc
        return Response(movement_register(
            plant_ids=plant_ids, stage=stage, kind=kind, query=params.get("q") or "",
            overdue_only=str(params.get("overdue") or "") in {"1", "true"}, page=page, page_size=page_size,
        ))
