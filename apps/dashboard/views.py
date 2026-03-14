from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .services import DashboardService
import logging

logger = logging.getLogger(__name__)


def _error_response(detail: str, http_status: int = status.HTTP_500_INTERNAL_SERVER_ERROR):
    return Response(
        {
            "status": "error",
            "message": "Request failed.",
            "detail": str(detail or "Unknown error"),
            "results": [],
            "data": {},
            "count": 0,
        },
        status=http_status,
    )

class DashboardViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def stats(self, request):
        try:
            stats = DashboardService.get_stats(request.user)
            return Response(stats)
        except Exception as e:
            logger.error(f"Dashboard stats error: {str(e)}", exc_info=True)
            return _error_response(str(e))

    @action(detail=False, methods=['get'])
    def search(self, request):
        try:
            query = request.query_params.get('q', '')
            if not query:
                return Response([])
            results = DashboardService.search_global(query)
            return Response(results)
        except Exception as e:
            logger.error(f"Dashboard search error: {str(e)}", exc_info=True)
            return _error_response(str(e))

    @action(detail=False, methods=['get'], url_path='search-v2')
    def search_v2(self, request):
        try:
            query = str(request.query_params.get('q', '') or '').strip()
            types_raw = str(request.query_params.get('types', '') or '').strip()
            requested_types = [part.strip().lower() for part in types_raw.split(',') if part.strip()]
            try:
                limit = int(request.query_params.get('limit', 30))
            except Exception:
                limit = 30
            limit = max(1, min(limit, 100))
            if not query:
                return Response(
                    {
                        "query": "",
                        "took_ms": 0,
                        "counts_by_type": {},
                        "results": [],
                    }
                )
            results = DashboardService.search_global_v2(
                query=query,
                user=request.user,
                limit=limit,
                requested_types=requested_types,
            )
            return Response(results)
        except Exception as e:
            logger.error(f"Dashboard search-v2 error: {str(e)}", exc_info=True)
            return _error_response(str(e))
