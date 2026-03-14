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
        plan = MRPPlan.objects.filter(status='COMPLETED').first()
        if not plan:
            return Response({"detail": "No completed MRP plan found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(MRPPlanSerializer(plan).data)

class MRPRequirementViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MRPRequirement.objects.all()
    serializer_class = MRPRequirementSerializer
    filterset_fields = ['plan', 'material', 'source_type']

class MRPSuggestionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MRPSuggestion.objects.all()
    serializer_class = MRPSuggestionSerializer
    filterset_fields = ['plan', 'type', 'material', 'target_plant']

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
