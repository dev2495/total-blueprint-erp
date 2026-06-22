from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import MRPPlan, MRPRequirement, MRPSuggestion
from .serializers import MRPPlanSerializer, MRPRequirementSerializer, MRPSuggestionSerializer
from .services import MRPService

class MRPViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MRPPlan.objects.all().order_by('-created_at')
    serializer_class = MRPPlanSerializer

    @action(detail=False, methods=['post'])
    def run(self, request):
        plant_id = request.data.get('plant_id')
        try:
            plan = MRPService.run_mrp(plant_id=plant_id, user=request.user)
            return Response(MRPPlanSerializer(plan).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def latest(self, request):
        plan = MRPPlan.objects.filter(status='COMPLETED').order_by('-created_at').first()
        if not plan:
            return Response({"detail": "No completed MRP plan found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(MRPPlanSerializer(plan).data)

    @action(detail=True, methods=['get'])
    def diff(self, request, pk=None):
        """Sprint 4 — compare two MRP plans line-by-line.

        ?vs=<other_plan_id>  (defaults to the latest completed plan older than this one)
        """
        from decimal import Decimal
        try:
            to_plan = MRPPlan.objects.get(pk=pk)
        except MRPPlan.DoesNotExist:
            return Response({"error": "plan not found"}, status=status.HTTP_404_NOT_FOUND)
        vs = request.query_params.get('vs')
        if vs:
            try:
                from_plan = MRPPlan.objects.get(pk=vs)
            except MRPPlan.DoesNotExist:
                return Response({"error": "vs plan not found"}, status=status.HTTP_404_NOT_FOUND)
        else:
            from_plan = (
                MRPPlan.objects.filter(status='COMPLETED', created_at__lt=to_plan.created_at)
                .order_by('-created_at')
                .first()
            )
            if not from_plan:
                return Response({
                    "from_plan": None,
                    "to_plan": MRPPlanSerializer(to_plan).data,
                    "added_materials": [],
                    "removed_materials": [],
                    "qty_changes": [],
                })

        def reqs(plan):
            out = {}
            for r in MRPRequirement.objects.filter(plan=plan).select_related('material'):
                out[str(r.material_id)] = {
                    "material_id": str(r.material_id),
                    "material_code": getattr(r.material, "code", ""),
                    "material_name": getattr(r.material, "name", ""),
                    "required_qty": float(r.required_qty_kg or 0),
                    "shortage": float(r.shortage_qty_kg or 0),
                }
            return out

        from_map = reqs(from_plan)
        to_map = reqs(to_plan)
        from_ids = set(from_map.keys())
        to_ids = set(to_map.keys())
        added = [to_map[mid] for mid in (to_ids - from_ids)]
        removed = [from_map[mid] for mid in (from_ids - to_ids)]
        qty_changes = []
        for mid in (from_ids & to_ids):
            f = from_map[mid]
            t = to_map[mid]
            if abs(t["required_qty"] - f["required_qty"]) > 1e-6:
                qty_changes.append({
                    "material_id": mid,
                    "material_code": t["material_code"],
                    "material_name": t["material_name"],
                    "from_qty": f["required_qty"],
                    "to_qty": t["required_qty"],
                    "delta": t["required_qty"] - f["required_qty"],
                })
        return Response({
            "from_plan": MRPPlanSerializer(from_plan).data,
            "to_plan": MRPPlanSerializer(to_plan).data,
            "added_materials": added,
            "removed_materials": removed,
            "qty_changes": qty_changes,
        })

class MRPRequirementViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MRPRequirementSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plan', 'material', 'source_type']

    def get_queryset(self):
        qs = MRPRequirement.objects.select_related('plan', 'material')
        params = self.request.query_params
        if params.get('plan'):
            qs = qs.filter(plan_id=params.get('plan'))
        if params.get('material'):
            qs = qs.filter(material_id=params.get('material'))
        if params.get('source_type'):
            qs = qs.filter(source_type=params.get('source_type'))
        return qs.order_by('-shortage_qty_kg', 'material__name')

class MRPSuggestionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MRPSuggestionSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plan', 'type', 'material', 'target_plant']

    def get_queryset(self):
        qs = MRPSuggestion.objects.select_related('plan', 'material', 'target_plant', 'source_plant')
        params = self.request.query_params
        if params.get('plan'):
            qs = qs.filter(plan_id=params.get('plan'))
        if params.get('type'):
            qs = qs.filter(type=params.get('type'))
        if params.get('material'):
            qs = qs.filter(material_id=params.get('material'))
        if params.get('target_plant'):
            qs = qs.filter(target_plant_id=params.get('target_plant'))
        return qs.order_by('-priority', '-qty', 'material__name')

    @action(detail=True, methods=['post'], url_path='create-draft-po')
    def create_draft_po(self, request, pk=None):
        suggestion = self.get_object()
        try:
            payload = MRPService.create_suggestion_draft(suggestion, 'po', request.user)
            data = MRPSuggestionSerializer(suggestion).data
            data.update(payload)
            return Response(data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='create-draft-job')
    def create_draft_job(self, request, pk=None):
        suggestion = self.get_object()
        try:
            payload = MRPService.create_suggestion_draft(suggestion, 'job', request.user)
            data = MRPSuggestionSerializer(suggestion).data
            data.update(payload)
            return Response(data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='create-draft-transfer')
    def create_draft_transfer(self, request, pk=None):
        suggestion = self.get_object()
        try:
            payload = MRPService.create_suggestion_draft(suggestion, 'transfer', request.user)
            data = MRPSuggestionSerializer(suggestion).data
            data.update(payload)
            return Response(data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='bulk-draft-po')
    def bulk_draft_po(self, request):
        ids = request.data.get('suggestion_ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({"error": "suggestion_ids (list) required."}, status=400)
        results = []
        errors = []
        for sid in ids:
            try:
                sug = MRPSuggestion.objects.get(pk=sid)
                if str(sug.type or '').upper() != 'PURCHASE':
                    errors.append({"suggestion_id": str(sid), "error": "Not a PURCHASE suggestion."})
                    continue
                payload = MRPService.create_suggestion_draft(sug, 'po', request.user)
                results.append(payload)
            except MRPSuggestion.DoesNotExist:
                errors.append({"suggestion_id": str(sid), "error": "Not found."})
            except Exception as e:
                errors.append({"suggestion_id": str(sid), "error": str(e)})
        return Response({"results": results, "errors": errors})
