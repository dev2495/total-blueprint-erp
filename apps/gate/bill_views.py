from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.users.permission_service import PermissionService
from .bill_serializers import BillFinishSerializer, BillLinkSerializer, BillReviewSerializer, BillUploadSerializer, BillVoidSerializer
from .bill_services import OPEN_STATUSES, bill_payload, bill_queryset, get_bill, receipt_candidates, resolve_bill, review_bill, upload_bill
from .models import InwardBillPage
from .services import date_bounds, get_plant, is_owner, is_watchman
from .views import FileNegotiation, GateView, paginated, period, private_response, uuid_param, validated


class BillView(GateView):
    permission_classes = [IsAuthenticated]


class BillsView(BillView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        source = bill_queryset(request.user)
        plant = uuid_param(request, "plant")
        if plant:
            allowed = PermissionService.inventory_review_plants(request.user) if PermissionService.has_inventory_bill_review(request.user) else None
            if allowed is not None and not allowed.filter(id=plant).exists():
                raise PermissionDenied("This receiving plant is unavailable.")
            if allowed is None:
                get_plant(request.user, plant)
            source = source.filter(plant_id=plant)
        reviewer = PermissionService.has_inventory_bill_review(request.user)
        if not reviewer and any(key in request.query_params for key in ["status", "date_from", "date_to"]):
            raise PermissionDenied("Bill history is available to inventory reviewers.")
        if reviewer:
            status = request.query_params.get("status", "OPEN")
            if status == "OPEN":
                source = source.filter(status__in=OPEN_STATUSES)
            elif status != "ALL":
                if status not in OPEN_STATUSES|{"RECEIPTED", "VOID"}:
                    raise ValidationError("Choose a valid inward bill status.")
                source = source.filter(status=status)
            if "date_from" in request.query_params or "date_to" in request.query_params:
                start, end = date_bounds(*period(request))
                source = source.filter(arrival_at__gte=start, arrival_at__lt=end)
            search = request.query_params.get("search", "").strip()[:100]
            if search:
                source = source.filter(review_data__invoice_number__icontains=search)
        return paginated(source, request, lambda obj: bill_payload(obj, request.user))

    def post(self, request):
        return Response(upload_bill(request.user, validated(BillUploadSerializer, request.data)), status=201)


class BillDetailView(BillView):
    def get(self, request, pk):
        return Response(bill_payload(get_bill(request.user, pk), request.user))


class BillPageView(BillView):
    content_negotiation_class = FileNegotiation

    def get(self, request, pk, page_id):
        bill = get_bill(request.user, pk)
        page = InwardBillPage.objects.filter(id=page_id, intake=bill).first()
        if not page:
            from rest_framework.exceptions import NotFound
            raise NotFound()
        return private_response(bytes(page.data), "image/jpeg")


class BillReviewView(BillView):
    def post(self, request, pk):
        return Response(review_bill(request.user, get_bill(request.user, pk, review=True), validated(BillReviewSerializer, request.data)))


class BillCandidatesView(BillView):
    def get(self, request, pk):
        bill = get_bill(request.user, pk, review=True)
        return Response({"results": receipt_candidates(bill, request.query_params.get("search", "").strip()[:100], uuid_param(request, "vendor_id")), "matching_is_manual": True})


class BillResolveView(BillView):
    def post(self, request, pk, action):
        serializers = {"link-receipts": BillLinkSerializer, "complete": BillFinishSerializer, "void": BillVoidSerializer}
        return Response(resolve_bill(request.user, get_bill(request.user, pk, review=True), validated(serializers[action], request.data), action))
