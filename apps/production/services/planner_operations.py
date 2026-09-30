"""Planner identity, optimistic revision checks, and durable retry receipts."""
import hashlib
import json
import uuid
from decimal import Decimal
from functools import wraps

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from rest_framework.response import Response

from apps.production.models import PlannedStockOrder, PlannerOperation
from apps.sales.models import SalesOrderItem


def entity_revision(kind, entity):
    fields = ('line_status', 'qty_value', 'qty_uom', 'qty_cancelled', 'qty_short_closed',
              'template_id', 'product_master_id', 'assigned_artwork_id', 'geometry_snapshot',
              'layer_snapshot', 'printing_snapshot', 'addons_snapshot', 'packaging_snapshot', 'bom_snapshot')
    if kind == 'stock':
        fields = ('status', 'target_qty', 'quantity_uom', 'template_id', 'start_step_index',
                  'stop_step_index', 'updated_at')
    data = {field: getattr(entity, field, None) for field in fields}
    for field in ('qty_value', 'qty_cancelled', 'qty_short_closed', 'target_qty'):
        if field in data and data[field] is not None:
            data[field] = str(Decimal(str(data[field])).normalize())
    return hashlib.sha256(json.dumps(data, cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()


def planner_operation(action):
    """Serialize one line's planner changes and replay only an identical request.

    Authentication and action permissions run in DRF before this decorator.
    Receipts and stock/job changes share one transaction; a failed operation
    cannot leave a success receipt or partial commit behind.
    """
    def decorate(handler):
        @wraps(handler)
        def wrapped(self, request, order_kind=None, order_id=None, **kwargs):
            raw_token = request.headers.get('Idempotency-Key') or request.data.get('operation_id')
            if not raw_token:
                return handler(self, request, order_kind=order_kind, order_id=order_id, **kwargs)
            try:
                token = uuid.UUID(str(raw_token))
            except ValueError:
                return Response({'error': 'A valid operation ID is required.'}, status=400)
            item_id = request.data.get('item_id') or request.data.get('sales_order_item_id')
            user_id = getattr(request.user, 'pk', None)
            scope = f'{user_id}:{action}:{order_kind}:{order_id}:{item_id or ""}'
            digest = hashlib.sha256(json.dumps(request.data, cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()
            with transaction.atomic():
                if connection.vendor == 'postgresql':
                    # Serialize a reused token even when it targets another line.
                    # The token lock always precedes the entity lock.
                    lock_key = int.from_bytes(token.bytes[:8], 'big', signed=True)
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT pg_advisory_xact_lock(%s)', [lock_key])
                if order_kind == 'sales':
                    entity = SalesOrderItem.objects.select_for_update().filter(id=item_id, sales_order_id=order_id).first() if item_id else None
                else:
                    entity = PlannedStockOrder.objects.select_for_update().filter(id=order_id).first()
                if entity is None:
                    return Response({'error': 'The requested order line was not found.'}, status=404)
                receipt = PlannerOperation.objects.filter(id=token).first()
                if receipt:
                    if receipt.scope != scope or receipt.payload_hash != digest:
                        return Response({'error': 'This operation ID was already used for a different request.'}, status=409)
                    response = Response(receipt.response_json, status=receipt.response_status)
                    response['Idempotency-Replayed'] = 'true'
                    return response
                expected = request.data.get('expected_revision')
                if expected and expected != entity_revision(order_kind, entity):
                    return Response({'error': 'This line changed. Refresh its detail before continuing.', 'code': 'STALE_REVISION'}, status=409)
                response = handler(self, request, order_kind=order_kind, order_id=order_id, **kwargs)
                if response.status_code >= 400:
                    transaction.set_rollback(True)
                    return response
                entity.refresh_from_db()
                response.data.update(operation_id=str(token), committed=True, sales_order_item_id=str(item_id) if item_id else None,
                                     line_status=getattr(entity, 'line_status', getattr(entity, 'status', '')),
                                     revision=entity_revision(order_kind, entity))
                stored = json.loads(json.dumps(response.data, cls=DjangoJSONEncoder))
                PlannerOperation.objects.create(id=token, scope=scope, payload_hash=digest, response_json=stored,
                                                response_status=response.status_code, created_by_id=user_id)
                return response
        return wrapped
    return decorate
