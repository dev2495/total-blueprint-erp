from rest_framework import viewsets, generics, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.views.decorators.clickjacking import xframe_options_exempt
from django.utils.dateparse import parse_date
from django.utils import timezone
from decimal import Decimal
from datetime import timedelta
from io import BytesIO
import uuid
from collections import defaultdict

from .models import (
    InventoryLocation,
    JobWorkOrder,
    DeliveryChallan,
    InventoryRoll,
    RollMovement,
    RollConsumption,
    InventoryBulk,
    PackagingStock,
    PackagingTransaction,
    Vendor,
)
from .serializers import (
    InventoryLocationSerializer, JobWorkOrderSerializer,
    BulkGRNSerializer, RollGRNSerializer, PackagingGRNSerializer, JobWorkDispatchSerializer, JobWorkReceiveSerializer,
    DeliveryChallanSerializer, ChallanDispatchSerializer, ChallanReceiveSerializer,
    InventoryRollSerializer, RollDetailSerializer, RollMovementSerializer, RollConsumptionSerializer,
    RollReserveSerializer, RollReleaseSerializer, RollMoveSerializer, RollConsumeSerializer,
    InventoryBulkSerializer, BulkTransactionSerializer,
    PackagingStockSerializer, PackagingTransactionSerializer,
    resolve_roll_role, resolve_roll_stage_name,
)
from .services.grn import GRNService
from .services.stock import StockService
from .services.job_work import JobWorkService
from .services.inter_plant import InterPlantService
from .services.challan_pdf import ChallanPDFService
from .services.roll_service import RollService
from .services.bulk_service import BulkService
from .services.packaging_service import PackagingService
from .services.roll_naming import (
    build_roll_naming_payload,
    build_variant_key,
    stock_strategy_label,
)
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.factory.models import Process, Machine
from django_filters.rest_framework import DjangoFilterBackend


def _inventory_roll_base_queryset():
    return InventoryRoll.objects.select_related(
        'material',
        'material__parent_family',
        'material__commercial_family',
        'material__parent_family__commercial_family',
        'location',
        'location__plant',
        'grade',
        'plant',
        'template',
        'template__commercial_family',
        'created_process',
        'created_by_job',
        'created_by_job__mts_order',
        'production_job',
        'parent_roll__created_process',
    )


def _roll_query_rows(params):
    plant_id = params.get('plant')
    stage_filter = (params.get('stage') or '').strip().lower()
    role_filter = (params.get('roll_role') or '').strip().upper()
    origin_type_filter = (params.get('origin_type') or '').strip().upper()
    stock_strategy_filter = (params.get('stock_strategy') or '').strip().upper()
    status_filter = params.get('status')
    material_id = params.get('material')
    grade_id = params.get('grade')
    location_id = params.get('location')
    family_id = params.get('family')
    job_number = (params.get('job_number') or '').strip()
    date_from = parse_date(params.get('date_from')) if params.get('date_from') else None
    date_to = parse_date(params.get('date_to')) if params.get('date_to') else None
    weight_min = Decimal(str(params.get('weight_min'))) if params.get('weight_min') else None
    weight_max = Decimal(str(params.get('weight_max'))) if params.get('weight_max') else None

    qs = _inventory_roll_base_queryset()
    if plant_id:
        qs = qs.filter(location__plant_id=plant_id)
    if material_id:
        qs = qs.filter(material_id=material_id)
    if grade_id:
        qs = qs.filter(grade_id=grade_id)
    if location_id:
        qs = qs.filter(location_id=location_id)
    if family_id:
        qs = qs.filter(
            Q(template__commercial_family_id=family_id)
            | Q(material__commercial_family_id=family_id)
            | Q(material__parent_family__commercial_family_id=family_id)
        )
    if status_filter:
        statuses = [s.strip().upper() for s in status_filter.split(',') if s.strip()]
        if statuses:
            qs = qs.filter(status__in=statuses)
    if job_number:
        qs = qs.filter(
            Q(created_by_job__job_number__icontains=job_number) |
            Q(production_job__job_number__icontains=job_number)
        )
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    if weight_min is not None:
        qs = qs.filter(weight_kg__gte=weight_min)
    if weight_max is not None:
        qs = qs.filter(weight_kg__lte=weight_max)

    rows = []
    for roll in qs.order_by('-created_at')[:2000]:
        role = resolve_roll_role(roll)
        stage_name = resolve_roll_stage_name(roll) or 'Raw Material'
        bucket_label = 'Remainder / Freed' if role == 'REMAINDER' else stage_name
        parent = getattr(roll, 'parent_roll', None)
        source_stage = resolve_roll_stage_name(parent) if parent else None
        naming = build_roll_naming_payload(roll, role=role, stage_name=stage_name)
        row = {
            'id': str(roll.id),
            'label_id': roll.label_id,
            'roll_role': role,
            'origin_type': naming['origin_type'],
            'origin_label': naming['origin_label'],
            'stock_strategy': naming['stock_strategy'],
            'stock_strategy_label': naming['stock_strategy_label'],
            'family_display_name': naming['family_display_name'],
            'display_name': naming['variant_display_name'],
            'variant_display_name': naming['variant_display_name'],
            'size_line': naming['size_line'],
            'form_label': naming['form_label'],
            'process_state_label': naming['process_state_label'],
            'availability_label': naming['availability_label'],
            'print_status': naming['print_status'],
            'lamination_status': naming['lamination_status'],
            'reporting_group': naming['reporting_group'],
            'variant_summary': " • ".join(
                part for part in [
                    naming['size_line'],
                    stage_name,
                    roll.location.name if roll.location else '',
                ] if str(part or '').strip()
            ),
            'consumability_mode': (
                'Direct consume'
                if naming['stock_strategy'] == 'FINAL_STOCK'
                else ('Packaging only' if naming['stock_strategy'] == 'PACKAGING_STOCK' else 'Continue from WIP')
            ),
            'is_quarantined': bool((roll.meta_json or {}).get('is_quarantined')),
            'status': roll.status,
            'stage_name': stage_name,
            'bucket_label': bucket_label,
            'source_stage_name': source_stage,
            'material_id': str(roll.material_id) if roll.material_id else None,
            'material_name': roll.material.name if roll.material else None,
            'grade_id': str(roll.grade_id) if roll.grade_id else None,
            'grade_name': roll.grade.name if roll.grade else None,
            'weight_kg': float(roll.weight_kg or 0),
            'width_mm': float(roll.width_mm or 0),
            'thickness_micron': float(roll.thickness_micron or 0),
            'location_id': str(roll.location_id) if roll.location_id else None,
            'location_name': roll.location.name if roll.location else None,
            'plant_id': str(roll.location.plant_id) if roll.location_id and roll.location and roll.location.plant_id else (str(roll.plant_id) if roll.plant_id else None),
            'plant_name': roll.location.plant.name if roll.location_id and roll.location and roll.location.plant else (roll.plant.name if roll.plant else None),
            'created_job_id': str(roll.created_by_job_id) if roll.created_by_job_id else None,
            'created_job_number': roll.created_by_job.job_number if roll.created_by_job else None,
            'production_job_id': str(roll.production_job_id) if roll.production_job_id else None,
            'production_job_number': roll.production_job.job_number if roll.production_job else None,
            'created_at': roll.created_at.isoformat() if roll.created_at else None,
        }
        rows.append(row)

    if stage_filter:
        rows = [r for r in rows if r.get('bucket_label', '').lower() == stage_filter or r.get('stage_name', '').lower() == stage_filter]
    if role_filter:
        rows = [r for r in rows if str(r.get('roll_role') or '').upper() == role_filter]
    if origin_type_filter:
        rows = [r for r in rows if str(r.get('origin_type') or '').upper() == origin_type_filter]
    if stock_strategy_filter:
        rows = [r for r in rows if str(r.get('stock_strategy') or '').upper() == stock_strategy_filter]
    return rows


def _group_rows_by_bucket(rows):
    buckets = {}
    totals_rolls = 0
    totals_weight = Decimal('0')
    remainder_rolls = 0
    remainder_weight = Decimal('0')
    for row in rows:
        key = row['bucket_label']
        if key not in buckets:
            buckets[key] = {
                'key': key,
                'label': key,
                'roll_count': 0,
                'weight_kg': 0.0,
                'rolls': [],
            }
        buckets[key]['roll_count'] += 1
        buckets[key]['weight_kg'] = round(float(Decimal(str(buckets[key]['weight_kg'])) + Decimal(str(row['weight_kg']))), 3)
        buckets[key]['rolls'].append(row)
        totals_rolls += 1
        totals_weight += Decimal(str(row['weight_kg']))
        if row.get('roll_role') == 'REMAINDER':
            remainder_rolls += 1
            remainder_weight += Decimal(str(row['weight_kg']))

    bucket_rows = list(buckets.values())
    bucket_rows.sort(key=lambda b: (b['label'] != 'Remainder / Freed', b['label']))
    return {
        'totals': {
            'roll_count': totals_rolls,
            'weight_kg': round(float(totals_weight), 3),
            'remainder_roll_count': remainder_rolls,
            'remainder_weight_kg': round(float(remainder_weight), 3),
        },
        'buckets': bucket_rows,
    }


def _group_rows_by_variant(rows):
    family_map: dict[tuple, dict] = {}
    for row in rows:
        family_key = (
            str(row.get('family_display_name') or '').strip(),
            str(row.get('form_label') or '').strip(),
            str(row.get('reporting_group') or '').strip(),
        )
        family_bucket = family_map.setdefault(
            family_key,
            {
                'family_key': "|".join(family_key),
                'family_display_name': row.get('family_display_name') or 'Material',
                'form_label': row.get('form_label') or 'Roll',
                'reporting_group': row.get('reporting_group') or 'OTHER',
                'total_roll_count': 0,
                'total_available_kg': 0.0,
                'total_reserved_kg': 0.0,
                'total_blocked_kg': 0.0,
                'oldest_age_days': 0,
                'variants': {},
            },
        )
        family_bucket['total_roll_count'] += 1
        if str(row.get('status') or '').upper() == 'AVAILABLE':
            family_bucket['total_available_kg'] += float(row.get('weight_kg') or 0)
        elif str(row.get('status') or '').upper() == 'RESERVED':
            family_bucket['total_reserved_kg'] += float(row.get('weight_kg') or 0)
        else:
            family_bucket['total_blocked_kg'] += float(row.get('weight_kg') or 0)
        age_days = 0
        try:
            from django.utils.dateparse import parse_datetime
            created_at = parse_datetime(str(row.get('created_at') or '')) if row.get('created_at') else None
            if created_at:
                age_days = max((timezone.now().date() - created_at.date()).days, 0)
        except Exception:
            age_days = 0
        family_bucket['oldest_age_days'] = max(family_bucket['oldest_age_days'], age_days)

        variant_payload = dict(row)
        variant_payload['blocked_kg'] = float(row.get('weight_kg') or 0) if str(row.get('status') or '').upper() not in {'AVAILABLE', 'RESERVED'} else 0.0
        variant_key = build_variant_key(variant_payload)
        variant_bucket = family_bucket['variants'].setdefault(
            variant_key,
            {
                'variant_key': "|".join(str(bit) for bit in variant_key),
                'variant_display_name': row.get('variant_display_name') or row.get('display_name') or 'Variant',
                'size_line': row.get('size_line') or '',
                'form_label': row.get('form_label') or 'Roll',
                'stage_name': row.get('stage_name') or '',
                'print_status': row.get('print_status') or '',
                'lamination_status': row.get('lamination_status') or '',
                'stock_strategy': row.get('stock_strategy') or '',
                'stock_strategy_label': row.get('stock_strategy_label') or stock_strategy_label(row.get('stock_strategy')),
                'roll_count': 0,
                'available_kg': 0.0,
                'reserved_kg': 0.0,
                'blocked_kg': 0.0,
                'oldest_age_days': 0,
                'plants': defaultdict(lambda: {'plant_name': '', 'locations': set(), 'available_kg': 0.0, 'reserved_kg': 0.0, 'blocked_kg': 0.0}),
                'rolls': [],
            },
        )
        variant_bucket['roll_count'] += 1
        weight = float(row.get('weight_kg') or 0)
        status = str(row.get('status') or '').upper()
        plant_key = str(row.get('plant_id') or row.get('plant_name') or '')
        plant_bucket = variant_bucket['plants'][plant_key]
        plant_bucket['plant_name'] = row.get('plant_name') or '-'
        if row.get('location_name'):
            plant_bucket['locations'].add(row.get('location_name'))
        if status == 'AVAILABLE':
            variant_bucket['available_kg'] += weight
            plant_bucket['available_kg'] += weight
        elif status == 'RESERVED':
            variant_bucket['reserved_kg'] += weight
            plant_bucket['reserved_kg'] += weight
        else:
            variant_bucket['blocked_kg'] += weight
            plant_bucket['blocked_kg'] += weight
        variant_bucket['oldest_age_days'] = max(variant_bucket['oldest_age_days'], age_days)
        variant_bucket['rolls'].append(row)

    families = []
    for family_bucket in family_map.values():
        variants = []
        for variant_bucket in family_bucket['variants'].values():
            variant_bucket['plant_summary'] = [
                {
                    'plant_name': plant['plant_name'],
                    'locations': sorted(location for location in plant['locations'] if location),
                    'available_kg': round(float(plant['available_kg']), 3),
                    'reserved_kg': round(float(plant['reserved_kg']), 3),
                    'blocked_kg': round(float(plant['blocked_kg']), 3),
                }
                for plant in variant_bucket['plants'].values()
            ]
            variant_bucket.pop('plants', None)
            variants.append(variant_bucket)
        variants.sort(key=lambda row: (row['variant_display_name'], row['stage_name'], row['stock_strategy']))
        family_bucket['variants'] = variants
        families.append(family_bucket)
    families.sort(key=lambda row: (row['family_display_name'], row['reporting_group']))
    return families

class LocationViewSet(viewsets.ModelViewSet):
    queryset = InventoryLocation.objects.all()
    serializer_class = InventoryLocationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plant', 'type', 'is_active']

class StockViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def bulk(self, request):
        plant_id = request.query_params.get('plant')
        location_id = request.query_params.get('location')
        if not plant_id:
            return Response({"error": "plant param required"}, status=400)
        
        data = StockService.get_bulk_stock(plant_id, location_id)
        return Response(data)

    @action(detail=False, methods=['get'])
    def rolls(self, request):
        plant_id = request.query_params.get('plant')
        location_id = request.query_params.get('location')
        if not plant_id:
            return Response({"error": "plant param required"}, status=400)
        
        data = StockService.get_roll_stock(plant_id, location_id)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='bulk-availability')
    def bulk_availability(self, request):
        """
        Return bulk availability grouped by plant + location for a material.
        Used by WCM to request inter-plant DC transfers.
        """
        material_id = request.query_params.get('material_id')
        exclude_plant_id = request.query_params.get('exclude_plant')
        if not material_id:
            return Response({"error": "material_id param required"}, status=400)

        from .models import InventoryBulk
        qs = InventoryBulk.objects.filter(material_id=material_id, qty_kg__gt=0).select_related('plant', 'location')
        if exclude_plant_id:
            qs = qs.exclude(plant_id=exclude_plant_id)

        grouped = {}
        for item in qs:
            plant_id = str(item.plant_id)
            if plant_id not in grouped:
                grouped[plant_id] = {
                    'plant_id': plant_id,
                    'plant_name': item.plant.name if item.plant else None,
                    'total_qty': 0.0,
                    'locations': []
                }
            grouped[plant_id]['total_qty'] += float(item.qty_kg or 0)
            grouped[plant_id]['locations'].append({
                'location_id': str(item.location_id),
                'location_name': item.location.name if item.location else None,
                'quantity': float(item.qty_kg or 0),
                'uom': 'KG'
            })

        return Response(list(grouped.values()))

class GRNViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'], url_path='bulk')
    def create_bulk(self, request):
        """Phase 56: Bulk GRN with cost tracking."""
        serializer = BulkGRNSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            material = InventoryMaterial.objects.get(id=data['material_id'])
            location = InventoryLocation.objects.get(id=data['location_id'])
            vendor = Vendor.objects.get(id=data['vendor_id'])
            plant = data.get('plant_id')
            if plant:
                from apps.factory.models import Plant
                plant = Plant.objects.get(id=plant)
            else:
                plant = location.plant
            
            GRNService.create_bulk_grn(
                material=material,
                location=location,
                vendor=vendor,
                quantity=float(data['quantity']),
                plant=plant,
                cost=float(data.get('cost', 0)),  # Phase 56: Cost for avg calculation
                reference=data.get('reference', "")
            )
            return Response({"status": "success"}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='roll')
    def create_roll(self, request):
        serializer = RollGRNSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            material = InventoryMaterial.objects.get(id=data['material_id'])
            location = InventoryLocation.objects.get(id=data['location_id'])
            vendor = Vendor.objects.get(id=data['vendor_id'])
            plant = data.get('plant_id')
            if plant:
                from apps.factory.models import Plant
                plant = Plant.objects.get(id=plant)
            else:
                plant = location.plant
            
            rolls_data = []
            for item in data['rolls']:
                # The serializer already validated these as Decimals or expected types
                rolls_data.append(dict(item))

            GRNService.create_roll_grn(
                material=material,
                location=location,
                vendor=vendor,
                plant=plant,
                rolls_data=rolls_data,
                reference=data.get('reference', "")
            )
            return Response({"status": "success"}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='packaging')
    def create_packaging(self, request):
        serializer = PackagingGRNSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            material = InventoryMaterial.objects.get(id=data['material_id'])
            location = InventoryLocation.objects.get(id=data['location_id'])
            vendor = Vendor.objects.get(id=data['vendor_id'])

            if str(material.category or '').upper() != 'PACKAGING':
                return Response({"error": "Packaging GRN requires category=PACKAGING material."}, status=status.HTTP_400_BAD_REQUEST)

            PackagingService.add_packaging_stock(
                material_id=material.id,
                qty=data['quantity'],
                location_id=location.id,
                cost=data.get('cost', 0),
                vendor_id=vendor.id,
                reference=data.get('reference', '') or 'PACKAGING_GRN',
            )
            return Response({"status": "success"}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

class JobWorkOrderViewSet(viewsets.ModelViewSet):
    queryset = JobWorkOrder.objects.all().order_by('-created_at')
    serializer_class = JobWorkOrderSerializer
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            detail = getattr(e, "detail", None)
            if isinstance(detail, dict):
                return Response(
                    {"status": "error", "message": "Validation failed.", "field_errors": detail},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response({"status": "error", "message": "Request failed."}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'], url_path='vendor-candidates')
    def vendor_candidates(self, request):
        process_code = str(request.query_params.get('process_code') or "").upper()
        plant_id = request.query_params.get('plant_id')
        production_job_id = request.query_params.get('production_job_id')
        plant = None
        if production_job_id:
            try:
                job = ProductionJob.objects.select_related(
                    'current_process',
                    'process',
                    'work_center__plant',
                    'from_location__plant',
                    'to_location__plant',
                ).get(id=production_job_id)
                process = job.current_process or job.process
                process_code = str(getattr(process, "code", process_code) or "").upper()
                if job.work_center and job.work_center.plant:
                    plant = job.work_center.plant
                elif job.from_location and job.from_location.plant:
                    plant = job.from_location.plant
                elif job.to_location and job.to_location.plant:
                    plant = job.to_location.plant
            except ProductionJob.DoesNotExist:
                return Response({"status": "error", "message": "production_job not found."}, status=status.HTTP_404_NOT_FOUND)
        elif plant_id:
            try:
                from apps.factory.models import Plant
                plant = Plant.objects.get(id=plant_id)
            except Exception:
                plant = None

        rows = []
        for vendor, verdict in JobWorkService.compatible_vendors(process_code=process_code, plant=plant):
            rows.append({
                "id": str(vendor.id),
                "name": vendor.name,
                "code": vendor.code,
                "type": vendor.type,
                "status": vendor.status,
                "turnaround_hours": vendor.turnaround_hours,
                "qc_required": vendor.qc_required,
                "jobwork_capabilities": vendor.jobwork_capabilities or [],
                "jobwork_plants": vendor.jobwork_plants or [],
                "vendor_capability_match": verdict["match"],
                "match_reasons": verdict["reasons"],
            })
        return Response({"results": rows})

    @action(detail=True, methods=['get'], url_path='eligible-rolls')
    def eligible_rolls(self, request, pk=None):
        try:
            order = self.get_object()
            qs = InventoryRoll.objects.select_related(
                'material',
                'location',
                'location__plant',
                'production_job',
            ).filter(location__plant=order.plant)
            if order.production_job_id:
                # Prefer source job rolls first.
                source_qs = qs.filter(
                    Q(production_job=order.production_job) | Q(created_by_job=order.production_job)
                )
                if source_qs.exists():
                    qs = source_qs
            qs = qs.filter(status__in=['AVAILABLE', 'RESERVED', 'IN_PROCESS', 'SENT_JOBWORK']).order_by('-created_at')[:200]
            rows = []
            for roll in qs:
                rows.append({
                    "id": str(roll.id),
                    "label_id": roll.label_id,
                    "material_name": getattr(roll.material, "name", None),
                    "status": roll.status,
                    "weight_kg": float(roll.weight_kg or 0),
                    "location_name": getattr(roll.location, "name", None),
                    "production_job_number": getattr(roll.production_job, "job_number", None),
                })
            return Response({"results": rows})
        except Exception as e:
            return Response({"status": "error", "message": "Request failed."}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='dispatch')
    def dispatch_order(self, request, pk=None):
        serializer = JobWorkDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            JobWorkService.dispatch_material(
                order_id=pk,
                roll_ids=[str(i) for i in data.get('roll_ids', [])],
                bulk_items=data.get('bulk_items')
            )
            return Response({"status": "dispatched"})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        serializer = JobWorkReceiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            target_location = InventoryLocation.objects.get(id=data['target_location_id'])
            
            received_rolls = []
            if 'received_rolls' in data:
                for item in data['received_rolls']:
                    r_dict = dict(item)
                    if 'material_id' not in r_dict or not r_dict['material_id']:
                         return Response({"error": "material_id required for received rolls"}, status=400)
                    
                    r_dict['material_id'] = str(r_dict['material_id']) 
                    r_dict['thickness_micron'] = float(r_dict['thickness_micron'])
                    r_dict['width_mm'] = float(r_dict['width_mm'])
                    r_dict['weight_kg'] = float(r_dict['weight_kg'])
                    if r_dict.get('grade_id'):
                        r_dict['grade_id'] = str(r_dict['grade_id'])
                    if 'length_m' in r_dict:
                        r_dict['length_m'] = float(r_dict['length_m'])
                    received_rolls.append(r_dict)
            
            received_bulk = data.get('received_bulk', [])

            JobWorkService.receive_material(
                order_id=pk,
                target_location=target_location,
                received_rolls=received_rolls,
                received_bulk=received_bulk
            )
            
            return Response({"status": "received"})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

class DeliveryChallanViewSet(viewsets.ModelViewSet):
    queryset = DeliveryChallan.objects.select_related(
        'from_plant',
        'to_plant',
        'source_job',
        'target_job',
    ).prefetch_related(
        'items__roll',
        'items__material',
        'items__from_location',
        'items__to_location',
    ).order_by('-created_at')
    serializer_class = DeliveryChallanSerializer
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            challan = InterPlantService.create_challan(
                from_plant_id=str(data["from_plant"].id),
                to_plant_id=str(data["to_plant"].id),
                source_job_id=str(data["source_job"].id) if data.get("source_job") else None,
                target_job_id=str(data["target_job"].id) if data.get("target_job") else None,
                is_system_generated=bool(data.get("is_system_generated", False)),
                vehicle_no=str(data.get("vehicle_no") or ""),
                driver_name=str(data.get("driver_name") or ""),
                driver_phone=str(data.get("driver_phone") or ""),
                transporter_name=str(data.get("transporter_name") or ""),
                lr_number=str(data.get("lr_number") or ""),
            )
            out = self.get_serializer(challan).data
            return Response(out, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='dispatch')
    def dispatch_dc(self, request, pk=None):
        serializer = ChallanDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            InterPlantService.dispatch_challan(
                challan_id=pk,
                roll_ids=[str(i) for i in data.get('roll_ids', [])],
                bulk_items=data.get('bulk_items'),
                target_location_id=str(data['target_location_id']) if data.get('target_location_id') else None,
            )
            return Response({"status": "dispatched"})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def receive_challan(self, request, pk=None):
        serializer = ChallanReceiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            InterPlantService.receive_challan(
                challan_id=pk,
                target_location_id=str(data['target_location_id']),
                roll_ids=[str(i) for i in data.get('roll_ids', [])],
                bulk_items=data.get('bulk_items', [])
            )
            return Response({"status": "received"})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @xframe_options_exempt
    @action(detail=True, methods=['get'], url_path='print-pdf')
    def print_pdf(self, request, pk=None):
        try:
            challan = self.get_object()
            pdf_bytes = ChallanPDFService.generate_pdf_bytes(challan)
            file_name = f"{challan.dc_no or str(challan.id)}.pdf"
            return FileResponse(
                BytesIO(pdf_bytes),
                as_attachment=False,
                filename=file_name,
                content_type='application/pdf',
            )
        except RuntimeError as e:
            return Response({"error": "Request failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)



class PlantLocationListView(generics.ListAPIView):
    serializer_class = InventoryLocationSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        plant_id = self.kwargs['pk']
        return InventoryLocation.objects.filter(plant_id=plant_id)


# ============================================================================
# PHASE 54: ROLL TRACKING VIEWS
# ============================================================================

class RollViewSet(viewsets.ModelViewSet):
    """
    Phase 56: Roll management endpoints.
    Provides CRUD operations plus genealogy, movement, reserve, consume, and WCM filtering.
    """
    queryset = InventoryRoll.objects.all().select_related(
        'material', 'grade', 'plant', 'location', 'created_by_job', 'created_process'
    ).order_by('-created_at')
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'stage_index', 'location', 'plant', 'material', 'grade', 'is_fg']
    
    def get_serializer_class(self):
        if self.action == 'retrieve' or self.action == 'genealogy':
            return RollDetailSerializer
        return InventoryRollSerializer
    
    def get_queryset(self):
        """
        Phase 56: Enhanced filtering for WCM Terminal.
        Supports thickness range, grade, stage, location, status filters.
        """
        queryset = super().get_queryset()
        
        # Thickness range filters (for WCM)
        thickness_min = self.request.query_params.get('thickness_min')
        thickness_max = self.request.query_params.get('thickness_max')
        if thickness_min:
            queryset = queryset.filter(thickness_micron__gte=Decimal(thickness_min))
        if thickness_max:
            queryset = queryset.filter(thickness_micron__lte=Decimal(thickness_max))
        
        # Width range filters
        width_min = self.request.query_params.get('width_min')
        width_max = self.request.query_params.get('width_max')
        if width_min:
            queryset = queryset.filter(width_mm__gte=Decimal(width_min))
        if width_max:
            queryset = queryset.filter(width_mm__lte=Decimal(width_max))
        
        # Weight range filters
        weight_min = self.request.query_params.get('weight_min')
        weight_max = self.request.query_params.get('weight_max')
        if weight_min:
            queryset = queryset.filter(weight_kg__gte=Decimal(weight_min))
        if weight_max:
            queryset = queryset.filter(weight_kg__lte=Decimal(weight_max))
        
        return queryset

    @action(detail=False, methods=['get'], url_path='for-wcm')
    def for_wcm(self, request):
        """
        Phase 56: WCM Terminal roll selection endpoint.
        Returns available/reserved rolls with full filtering.
        
        Query params:
        - material: UUID (variant)
        - thickness_min, thickness_max: microns
        - grade: UUID
        - stage_index: 0-5
        - location: UUID
        - status: AVAILABLE, RESERVED
        """
        queryset = self.get_queryset().filter(
            status__in=['AVAILABLE', 'RESERVED']
        )
        
        # Apply additional filters from query params
        material_id = request.query_params.get('material')
        if material_id:
            queryset = queryset.filter(material_id=material_id)
        
        grade_id = request.query_params.get('grade')
        if grade_id:
            queryset = queryset.filter(grade_id=grade_id)
        
        stage_index = request.query_params.get('stage_index')
        if stage_index is not None:
            queryset = queryset.filter(stage_index=int(stage_index))
        
        location_id = request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(location_id=location_id)
        
        plant_id = request.query_params.get('plant')
        if plant_id:
            queryset = queryset.filter(plant_id=plant_id)
        
        # Limit results for performance (after robust quarantine filtering).
        rows = [
            roll for roll in queryset
            if not bool(((getattr(roll, "meta_json", None) or {}).get("is_quarantined")))
        ][:100]

        return Response(InventoryRollSerializer(rows, many=True).data)

    @action(detail=True, methods=['post'], url_path='split')
    def split_for_claim(self, request, pk=None):
        try:
            roll = InventoryRoll.objects.select_related(
                "material",
                "grade",
                "plant",
                "location",
                "location__plant",
                "template",
                "sales_order_item",
                "created_by_job",
                "created_process",
                "production_job",
            ).get(id=pk)
        except InventoryRoll.DoesNotExist:
            return Response({"error": "Roll not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            child_weight = Decimal(str(request.data.get("child_weight_kg") or 0))
        except Exception:
            return Response({"error": "child_weight_kg must be numeric"}, status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get("reason") or "SALES_CLAIM").upper()
        if roll.status != "AVAILABLE":
            return Response({"error": f"Roll {roll.label_id} must be AVAILABLE before split."}, status=status.HTTP_400_BAD_REQUEST)
        if child_weight <= 0:
            return Response({"error": "child_weight_kg must be > 0"}, status=status.HTTP_400_BAD_REQUEST)
        if child_weight >= Decimal(str(roll.weight_kg or 0)):
            return Response(
                {"error": f"child_weight_kg must be less than parent weight ({roll.weight_kg} KG)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if reason == "SALES_CLAIM" and roll.sales_order_item_id:
            return Response(
                {"error": f"Roll {roll.label_id} already has sales-order lineage. Split it before claim, not after claim."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.production.models import InventoryAllocation

        if InventoryAllocation.objects.filter(inventory_roll=roll, status="ACTIVE").exists():
            return Response(
                {"error": f"Roll {roll.label_id} already has an active allocation and cannot be split safely."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        balance_weight = Decimal(str(roll.weight_kg or 0)) - child_weight
        try:
            children = RollService.split_roll(
                parent_roll=roll,
                splits=[
                    {
                        "weight_kg": child_weight,
                        "label_suffix": "CLAIM",
                        "meta": {
                            "split_parent_id": str(roll.id),
                            "split_parent_label": roll.label_id,
                            "split_role": "CLAIM_CHILD",
                            "split_reason": reason,
                        },
                    },
                    {
                        "weight_kg": balance_weight,
                        "label_suffix": "BAL",
                        "meta": {
                            "split_parent_id": str(roll.id),
                            "split_parent_label": roll.label_id,
                            "split_role": "BALANCE_CHILD",
                            "split_reason": reason,
                        },
                    },
                ],
                reason=reason,
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        split_children = {str((child.meta_json or {}).get("split_role") or ""): child for child in children}
        claim_child = split_children.get("CLAIM_CHILD")
        balance_child = split_children.get("BALANCE_CHILD")

        parent_meta = dict(roll.meta_json or {})
        history = list(parent_meta.get("split_history") or [])
        history.append(
            {
                "reason": reason,
                "child_weight_kg": float(child_weight),
                "balance_weight_kg": float(balance_weight),
                "claim_child_id": str(claim_child.id) if claim_child else None,
                "balance_child_id": str(balance_child.id) if balance_child else None,
            }
        )
        parent_meta["split_history"] = history
        parent_meta["last_split_reason"] = reason
        roll.meta_json = parent_meta
        roll.save(update_fields=["meta_json"])

        return Response(
            {
                "status": "split",
                "parent_roll_id": str(roll.id),
                "parent_roll_label": roll.label_id,
                "claim_roll": InventoryRollSerializer(claim_child).data if claim_child else None,
                "balance_roll": InventoryRollSerializer(balance_child).data if balance_child else None,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get'], url_path='availability')
    def roll_availability(self, request):
        """
        Return roll availability grouped by plant for a given spec.
        Used by WCM to request inter-plant roll transfers.
        """
        variant_id = request.query_params.get('variant_id')
        family_id = request.query_params.get('family_id')
        thickness = request.query_params.get('thickness_micron')
        grade_id = request.query_params.get('grade_id')
        min_width = request.query_params.get('min_width_mm')
        exclude_plant_id = request.query_params.get('exclude_plant')

        qs = InventoryRoll.objects.filter(
            status='AVAILABLE',
            material__isnull=False,
            thickness_micron__gt=0,
            width_mm__gt=0,
            grade__isnull=False
        ).select_related('plant', 'location', 'material', 'grade')
        if variant_id:
            qs = qs.filter(material_id=variant_id)
        elif family_id:
            qs = qs.filter(material__parent_family_id=family_id)
        if thickness:
            try:
                qs = qs.filter(Q(thickness_micron=Decimal(str(thickness))))
            except Exception:
                pass
        if grade_id:
            qs = qs.filter(Q(grade_id=grade_id))
        if min_width:
            try:
                qs = qs.filter(Q(width_mm__gte=Decimal(str(min_width))))
            except Exception:
                pass
        if exclude_plant_id:
            qs = qs.exclude(location__plant_id=exclude_plant_id)

        grouped = {}
        for roll in qs:
            if bool(((getattr(roll, "meta_json", None) or {}).get("is_quarantined"))):
                continue
            plant_id = str(roll.location.plant_id) if roll.location else str(roll.plant_id)
            plant_name = roll.location.plant.name if roll.location and roll.location.plant else (roll.plant.name if roll.plant else None)
            if plant_id not in grouped:
                grouped[plant_id] = {
                    'plant_id': plant_id,
                    'plant_name': plant_name,
                    'total_rolls': 0,
                    'total_weight_kg': 0.0,
                    'rolls': []
                }
            grouped[plant_id]['total_rolls'] += 1
            grouped[plant_id]['total_weight_kg'] += float(roll.weight_kg or 0)
            grouped[plant_id]['rolls'].append({
                'id': str(roll.id),
                'label_id': roll.label_id,
                'material_id': str(roll.material_id) if roll.material_id else None,
                'material_name': roll.material.name if roll.material else None,
                'family_id': str(roll.material.parent_family_id) if roll.material and roll.material.parent_family_id else None,
                'weight_kg': float(roll.weight_kg or 0),
                'width_mm': float(roll.width_mm or 0),
                'thickness_micron': float(roll.thickness_micron or 0),
                'grade_id': str(roll.grade_id) if roll.grade_id else None,
                'grade_name': roll.grade.name if roll.grade else None,
                'location_id': str(roll.location_id) if roll.location_id else None,
                'location_name': roll.location.name if roll.location else None
            })

        return Response(list(grouped.values()))

    @action(detail=True, methods=['get'])
    def genealogy(self, request, pk=None):
        """Get full genealogy tree for a roll."""
        try:
            roll = self.get_object()
            genealogy = RollService.get_genealogy(roll)
            descendants = RollService.get_descendants(roll)
            return Response({
                'roll': RollDetailSerializer(roll).data,
                'ancestors': genealogy['ancestors'],
                'descendants': descendants
            })
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        """Move a roll to a new location."""
        serializer = RollMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            roll = self.get_object()
            to_location = InventoryLocation.objects.get(id=data['to_location_id'])
            job = None
            if data.get('job_id'):
                job = ProductionJob.objects.get(id=data['job_id'])
            
            movement = RollService.move_roll(
                roll=roll,
                to_location=to_location,
                reason=data['reason'],
                reason_note=data.get('reason_note', ''),
                job=job,
                user=request.user
            )
            return Response({
                "status": "moved",
                "movement": RollMovementSerializer(movement).data
            })
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def reserve(self, request):
        """Reserve multiple rolls for a production job."""
        serializer = RollReserveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            rolls = InventoryRoll.objects.filter(id__in=data['roll_ids'])
            job = ProductionJob.objects.get(id=data['job_id'])
            
            reserved = RollService.reserve_rolls(list(rolls), job)
            return Response({
                "status": "reserved",
                "count": len(reserved),
                "rolls": InventoryRollSerializer(reserved, many=True).data
            })
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def release(self, request):
        """Release reserved rolls back to available."""
        serializer = RollReleaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            rolls = InventoryRoll.objects.filter(id__in=data['roll_ids'])
            released = RollService.release_rolls(list(rolls))
            return Response({
                "status": "released",
                "count": len(released)
            })
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='quarantine')
    def quarantine(self, request, pk=None):
        """Mark roll as quarantined (excluded from planning/auto-pick)."""
        try:
            roll = self.get_object()
            meta = dict(roll.meta_json or {})
            meta["is_quarantined"] = True
            reason = request.data.get("reason")
            if reason:
                meta["quarantine_reason"] = str(reason)
            roll.meta_json = meta
            roll.save(update_fields=["meta_json"])
            return Response({"status": "quarantined", "roll": InventoryRollSerializer(roll).data})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='unquarantine')
    def unquarantine(self, request, pk=None):
        """Clear quarantine marker."""
        try:
            roll = self.get_object()
            meta = dict(roll.meta_json or {})
            meta["is_quarantined"] = False
            meta.pop("quarantine_reason", None)
            roll.meta_json = meta
            roll.save(update_fields=["meta_json"])
            return Response({"status": "unquarantined", "roll": InventoryRollSerializer(roll).data})
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def consume(self, request):
        """
        Consume rolls for a production job.
        Creates output, balance, and scrap rolls automatically.
        """
        serializer = RollConsumeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        try:
            job = ProductionJob.objects.get(id=data['job_id'])
            process = Process.objects.get(id=data['process_id'])
            machine = Machine.objects.get(id=data['machine_id'])
            output_location = None
            if data.get('output_location_id'):
                output_location = InventoryLocation.objects.get(id=data['output_location_id'])
            
            results = []
            for input_data in data['inputs']:
                roll = InventoryRoll.objects.get(id=input_data['roll_id'])
                result = RollService.consume_roll(
                    input_roll=roll,
                    job=job,
                    process=process,
                    machine=machine,
                    used_kg=Decimal(str(input_data['used_kg'])),
                    scrap_kg=Decimal(str(input_data.get('scrap_kg', 0))),
                    output_location=output_location,
                    user=request.user,
                    notes=data.get('notes', '')
                )
                result_data = {
                    'input_roll': roll.label_id,
                    'output_roll': result['output_roll'].label_id if result['output_roll'] else None,
                    'balance_roll': result['balance_roll'].label_id if result['balance_roll'] else None,
                    'scrap_roll': result['scrap_roll'].label_id if result['scrap_roll'] else None,
                }
                results.append(result_data)
            
            return Response({
                "status": "consumed",
                "results": results
            })
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'], url_path='by-stage')
    def by_stage(self, request):
        """Get rolls grouped by resolved process stage for Roll Explorer tree view."""
        try:
            plant_id = request.query_params.get('plant')
            qs = InventoryRoll.objects.filter(
                status__in=['AVAILABLE', 'RESERVED']
            ).select_related('material', 'location', 'grade', 'plant', 'created_process', 'parent_roll__created_process')
            if plant_id:
                qs = qs.filter(location__plant_id=plant_id)

            stages = {
                'Raw Material': [],
                'Extruded': [],
                'Printed': [],
                'Laminated': [],
                'Slit': [],
                'Finished Good': [],
                'Remainder / Freed': [],
            }
            for roll in qs[:500]:
                stage_name = resolve_roll_stage_name(roll) or 'Raw Material'
                role = resolve_roll_role(roll)
                if role == 'REMAINDER':
                    stage_name = 'Remainder / Freed'
                if stage_name not in stages:
                    stages[stage_name] = []
                stages[stage_name].append(InventoryRollSerializer(roll).data)

            return Response(stages)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'], url_path='explorer')
    def explorer(self, request):
        """
        Rich explorer payload with resolved stage + role grouping.
        Supports filters and returns both grouped buckets and flat rows.
        """
        try:
            params = request.query_params
            mode = (params.get('mode') or 'grouped').strip().lower()
            rows = _roll_query_rows(params)
            grouped = _group_rows_by_bucket(rows)

            payload = {
                'meta': {
                    'mode': mode,
                    'filters': {
                        'plant': params.get('plant'),
                        'stage': (params.get('stage') or '').strip().lower() or None,
                        'roll_role': (params.get('roll_role') or '').strip().upper() or None,
                        'origin_type': (params.get('origin_type') or '').strip().upper() or None,
                        'stock_strategy': (params.get('stock_strategy') or '').strip().upper() or None,
                        'status': params.get('status'),
                        'material': params.get('material'),
                        'grade': params.get('grade'),
                        'location': params.get('location'),
                        'family': params.get('family'),
                        'job_number': (params.get('job_number') or '').strip() or None,
                        'date_from': params.get('date_from'),
                        'date_to': params.get('date_to'),
                        'weight_min': params.get('weight_min'),
                        'weight_max': params.get('weight_max'),
                    }
                },
                'totals': grouped['totals'],
                'buckets': grouped['buckets'],
                'rows': rows if mode == 'table' else [],
            }
            return Response(payload)
        except Exception as e:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'], url_path='by-variant')
    def by_variant(self, request):
        """Variant-first stock view grouped as family -> variant -> rolls."""
        try:
            params = request.query_params
            rows = _roll_query_rows(params)
            grouped = _group_rows_by_bucket(rows)
            payload = {
                'meta': {
                    'filters': {
                        'plant': params.get('plant'),
                        'stage': (params.get('stage') or '').strip().lower() or None,
                        'roll_role': (params.get('roll_role') or '').strip().upper() or None,
                        'origin_type': (params.get('origin_type') or '').strip().upper() or None,
                        'stock_strategy': (params.get('stock_strategy') or '').strip().upper() or None,
                        'status': params.get('status'),
                        'material': params.get('material'),
                        'grade': params.get('grade'),
                        'location': params.get('location'),
                        'family': params.get('family'),
                        'job_number': (params.get('job_number') or '').strip() or None,
                        'date_from': params.get('date_from'),
                        'date_to': params.get('date_to'),
                        'weight_min': params.get('weight_min'),
                        'weight_max': params.get('weight_max'),
                    }
                },
                'totals': grouped['totals'],
                'families': _group_rows_by_variant(rows),
            }
            return Response(payload)
        except Exception:
            return Response({"error": "Request failed"}, status=status.HTTP_400_BAD_REQUEST)


class RollMovementListView(generics.ListAPIView):
    """List view for roll movements (movement log page)."""
    queryset = RollMovement.objects.all().select_related(
        'roll', 'from_location', 'to_location', 'job', 'moved_by'
    ).order_by('-timestamp')
    serializer_class = RollMovementSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['roll', 'from_location', 'to_location', 'reason']


class RollConsumptionListView(generics.ListAPIView):
    """List view for roll consumptions (scrap report support)."""
    queryset = RollConsumption.objects.all().select_related(
        'job', 'process', 'input_roll', 'output_roll', 'machine', 'operator'
    ).order_by('-timestamp')
    serializer_class = RollConsumptionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['job', 'process', 'machine']


# ============================================================================
# PHASE 56: BULK INVENTORY VIEWS
# ============================================================================

from .models import InventoryBulk, BulkTransaction

class InventoryLedgerView(APIView):
    """
    Lightweight ledger endpoint (Phase 56+).

    InventoryLedger table was removed in Phase 58/0021; the UI still expects a
    unified "ledger" feed. We reconstruct it from:
    - BulkTransaction (bulk movements)
    - RollMovement (roll movements)

    Response shape matches `frontend_v2/src/app/(dashboard)/inventory/ledger/page.tsx`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        tx_type_filter = (request.query_params.get("tx_type") or "ALL").upper()
        limit = int(request.query_params.get("limit") or 500)

        def include_tx(tx_type: str) -> bool:
            return tx_type_filter == "ALL" or tx_type == tx_type_filter

        items: list[dict] = []

        # ------------------------
        # Bulk transactions
        # ------------------------
        bulk_map = {
            "INWARD": "GRN",
            "CONSUME": "CONSUMPTION",
            "TRANSFER": "TRANSFER",
            "ADJUST": "ADJUST",
        }
        bulk_qs = BulkTransaction.objects.select_related(
            "material",
            "location__plant",
        ).order_by("-created_at")[:limit]

        for tx in bulk_qs:
            tx_type = bulk_map.get(tx.type, "ADJUST")
            if not include_tx(tx_type):
                continue

            items.append(
                {
                    "id": str(tx.id),
                    "tx_type": tx_type,
                    "quantity": float(tx.qty_kg or 0),
                    "uom": "KG",
                    "material_name": tx.material.name if tx.material else None,
                    "item_label_id": None,
                    "from_location_name": None,
                    "to_location_name": tx.location.name if tx.location else None,
                    "plant_name": tx.location.plant.name if tx.location and tx.location.plant else None,
                    "reference": tx.reference or None,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                }
            )

        # ------------------------
        # Roll movements
        # ------------------------
        roll_map = {
            "GRN": "GRN",
            "PRODUCTION": "CONSUMPTION",
            "DISPATCH": "DISPATCH",
            "JOBWORK_OUT": "DISPATCH",
            "JOBWORK_IN": "RECEIVE",
            "INTER_PLANT": "TRANSFER",
            "WIP_TRANSFER": "TRANSFER",
            "FG_TRANSFER": "TRANSFER",
            "SCRAP": "CONSUMPTION",
            "ADJUSTMENT": "ADJUST",
        }
        roll_qs = RollMovement.objects.select_related(
            "roll__material",
            "from_location__plant",
            "to_location__plant",
            "job",
        ).order_by("-timestamp")[:limit]

        for mv in roll_qs:
            tx_type = roll_map.get(mv.reason, "TRANSFER")
            if not include_tx(tx_type):
                continue

            reference = mv.reason_note or ""
            if mv.job_id:
                reference = (reference + " " if reference else "") + f"JOB:{mv.job.job_number}"
            reference = reference or None

            items.append(
                {
                    "id": str(mv.id),
                    "tx_type": tx_type,
                    "quantity": float(mv.roll.weight_kg or 0) if mv.roll else 0,
                    "uom": "KG",
                    "material_name": mv.roll.material.name if mv.roll and mv.roll.material else None,
                    "item_label_id": mv.roll.label_id if mv.roll else None,
                    "from_location_name": mv.from_location.name if mv.from_location else None,
                    "to_location_name": mv.to_location.name if mv.to_location else None,
                    "plant_name": mv.to_location.plant.name if mv.to_location and mv.to_location.plant else None,
                    "reference": reference,
                    "created_at": mv.timestamp.isoformat() if mv.timestamp else None,
                }
            )

        # Newest first
        items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return Response(items[:limit])

class BulkInventoryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Unified Bulk Inventory view (pooled).
    """
    queryset = InventoryBulk.objects.all().select_related(
        'material', 'location', 'plant'
    ).order_by('material__name')
    serializer_class = InventoryBulkSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plant', 'location', 'material']

    @action(detail=False, methods=['post'])
    def inward(self, request):
        """Inward bulk material."""
        data = request.data
        try:
            tx = BulkService.add_bulk(
                material_id=data['material_id'],
                qty=Decimal(str(data['qty_kg'])),
                plant_id=data['plant_id'],
                location_id=data['location_id'],
                cost=Decimal(str(data.get('avg_cost', 0))),
                reference=data.get('reference', '')
            )
            return Response(BulkTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": "Request failed"}, status=400)

    @action(detail=False, methods=['post'])
    def consume(self, request):
        """Consume bulk material."""
        data = request.data
        try:
            tx = BulkService.consume_bulk(
                material_id=data['material_id'],
                qty=Decimal(str(data['qty_kg'])),
                location_id=data['location_id'],
                job_id=data.get('job_id'),
                reference=data.get('reference', '')
            )
            return Response(BulkTransactionSerializer(tx).data)
        except Exception as e:
            return Response({"error": "Request failed"}, status=400)

    @action(detail=False, methods=['post'])
    def transfer(self, request):
        """Transfer bulk material between locations."""
        data = request.data
        try:
            BulkService.transfer_bulk(
                material_id=data['material_id'],
                qty=Decimal(str(data['qty_kg'])),
                from_location_id=data['from_location_id'],
                to_location_id=data['to_location_id'],
                reference=data.get('reference', '')
            )
            return Response({"status": "transferred"})
        except Exception as e:
            return Response({"error": "Request failed"}, status=400)

class BulkTransactionListView(generics.ListAPIView):
    """Audit log for Bulk Transactions."""
    queryset = BulkTransaction.objects.all().select_related(
        'material', 'location', 'job'
    ).order_by('-created_at')
    serializer_class = BulkTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['material', 'location', 'type']


class PackagingStockViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PackagingStock.objects.all().select_related(
        'material', 'location', 'plant'
    ).order_by('material__name')
    serializer_class = PackagingStockSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plant', 'location', 'material']


class PackagingTransactionListView(generics.ListAPIView):
    queryset = PackagingTransaction.objects.all().select_related(
        'material', 'location', 'vendor', 'job', 'sales_order_item', 'mts_order'
    ).order_by('-created_at')
    serializer_class = PackagingTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['material', 'location', 'type']


# ============================================================================
# PHASE 58: OBSERVABILITY & TRACEABILITY VIEWS
# ============================================================================

from .models import InventorySnapshot, InventoryAlert
from .serializers import InventorySnapshotSerializer, InventoryAlertSerializer, AlertResolveSerializer
from .services.inventory_audit_service import InventoryAuditService


class InventoryHealthView(generics.GenericAPIView):
    """
    GET /api/inventory/health/
    Returns current inventory health metrics, alerts summary, and shortages.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        plant_id = request.query_params.get('plant')
        plant = None
        if plant_id:
            from apps.factory.models import Plant
            try:
                plant = Plant.objects.get(id=plant_id)
            except Plant.DoesNotExist:
                return Response({"error": "Plant not found"}, status=404)
        
        try:
            health = InventoryAuditService.get_health_summary(plant)
            return Response(health)
        except Exception as e:
            return Response({"error": "Request failed"}, status=500)


class InventoryAlertViewSet(viewsets.ModelViewSet):
    """
    Inventory Alerts management.
    GET /api/inventory/alerts/
    POST /api/inventory/alerts/{id}/resolve/
    """
    queryset = InventoryAlert.objects.all().select_related(
        'material', 'roll', 'plant', 'resolved_by'
    ).order_by('-created_at')
    serializer_class = InventoryAlertSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['type', 'severity', 'resolved', 'plant']
    
    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Mark an alert as resolved."""
        alert = self.get_object()
        if alert.resolved:
            return Response({"error": "Alert already resolved"}, status=400)
        
        serializer = AlertResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        from django.utils import timezone
        alert.resolved = True
        alert.resolved_at = timezone.now()
        alert.resolved_by = request.user
        alert.resolution_note = serializer.validated_data.get('resolution_note', '')
        alert.save()
        
        return Response(InventoryAlertSerializer(alert).data)
    
    @action(detail=False, methods=['post'])
    def run_audit(self, request):
        """Manually trigger a reconciliation audit."""
        plant_id = request.data.get('plant_id')
        plant = None
        if plant_id:
            from apps.factory.models import Plant
            try:
                plant = Plant.objects.get(id=plant_id)
            except Plant.DoesNotExist:
                return Response({"error": "Plant not found"}, status=404)
        
        try:
            summary = InventoryAuditService.run_full_audit(plant)
            return Response(summary)
        except Exception as e:
            return Response({"error": "Request failed"}, status=500)


class InventorySnapshotViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/inventory/snapshots/
    Historical inventory snapshots for trending and analysis.
    """
    queryset = InventorySnapshot.objects.all().select_related('plant').order_by('-created_at')
    serializer_class = InventorySnapshotSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['plant']

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        try:
            days = int(request.query_params.get("days", 180))
        except (TypeError, ValueError):
            days = 180
        days = max(7, min(days, 730))

        try:
            limit = int(request.query_params.get("limit", 180))
        except (TypeError, ValueError):
            limit = 180
        limit = max(1, min(limit, 500))

        cutoff = timezone.now() - timedelta(days=days)
        queryset = queryset.filter(created_at__gte=cutoff).order_by("-created_at")

        serializer = self.get_serializer(queryset[:limit], many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def create_now(self, request):
        """Create a snapshot immediately."""
        plant_id = request.data.get('plant_id')
        if not plant_id:
            return Response({"error": "plant_id required"}, status=400)
        
        from apps.factory.models import Plant
        try:
            plant = Plant.objects.get(id=plant_id)
        except Plant.DoesNotExist:
            return Response({"error": "Plant not found"}, status=404)
        
        try:
            snapshot = InventoryAuditService.create_snapshot(plant)
            return Response(InventorySnapshotSerializer(snapshot).data, status=201)
        except Exception as e:
            return Response({"error": "Request failed"}, status=500)


class RollGenealogyView(generics.GenericAPIView):
    """
    GET /api/inventory/rolls/{id}/genealogy/
    Returns full genealogy tree for a roll.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, pk):
        try:
            genealogy = InventoryAuditService.get_roll_genealogy(str(pk))
            if 'error' in genealogy:
                return Response(genealogy, status=404)
            return Response(genealogy)
        except Exception as e:
            return Response({"error": "Request failed"}, status=500)


class RollTraceLookupView(generics.GenericAPIView):
    """
    GET /api/inventory/roll-trace/?q=<roll-id-or-label>
    Resolve by UUID or label and return rich genealogy payload.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if not query:
            return Response({"error": "q query param is required"}, status=400)

        roll = None
        matched_by = None

        try:
            roll_uuid = uuid.UUID(query)
            roll = InventoryRoll.objects.select_related(
                "material", "grade", "location", "location__plant", "production_job", "created_by_job", "created_process"
            ).filter(id=roll_uuid).first()
            matched_by = "id" if roll else None
        except Exception:
            roll = None

        if not roll:
            roll = InventoryRoll.objects.select_related(
                "material", "grade", "location", "location__plant", "production_job", "created_by_job", "created_process"
            ).filter(label_id__iexact=query).first()
            matched_by = "label_exact" if roll else matched_by

        if not roll:
            roll = InventoryRoll.objects.select_related(
                "material", "grade", "location", "location__plant", "production_job", "created_by_job", "created_process"
            ).filter(label_id__icontains=query).order_by("-created_at").first()
            matched_by = "label_contains" if roll else matched_by

        if not roll:
            return Response({"error": "Roll not found for provided query"}, status=404)

        genealogy = InventoryAuditService.get_roll_genealogy(str(roll.id))
        if "error" in genealogy:
            return Response(genealogy, status=404)

        stage_name = resolve_roll_stage_name(roll)
        roll_role = resolve_roll_role(roll)
        recent_movements = list(
            RollMovement.objects.filter(roll=roll).select_related("from_location", "to_location").order_by("-timestamp")[:8]
        )

        payload = {
            "query": query,
            "matched_by": matched_by,
            "roll": {
                "id": str(roll.id),
                "label_id": roll.label_id,
                "material_name": roll.material.name if roll.material else None,
                "material_code": roll.material.code if roll.material else None,
                "grade_name": roll.grade.name if roll.grade else None,
                "weight_kg": float(roll.weight_kg or 0),
                "original_weight_kg": float(roll.original_weight_kg or 0),
                "width_mm": float(roll.width_mm or 0),
                "thickness_micron": float(roll.thickness_micron or 0),
                "status": roll.status,
                "stage_name": stage_name,
                "roll_role": roll_role,
                "location_name": roll.location.name if roll.location else None,
                "plant_name": roll.location.plant.name if roll.location and roll.location.plant else None,
                "job_number": (
                    roll.production_job.job_number if roll.production_job else
                    (roll.created_by_job.job_number if roll.created_by_job else None)
                ),
                "created_at": roll.created_at.isoformat() if roll.created_at else None,
            },
            "genealogy": genealogy,
            "recent_movements": [
                {
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                    "from_location_name": m.from_location.name if m.from_location else None,
                    "to_location_name": m.to_location.name if m.to_location else None,
                    "reason": m.reason,
                    "reason_note": m.reason_note,
                }
                for m in recent_movements
            ],
        }
        return Response(payload)
