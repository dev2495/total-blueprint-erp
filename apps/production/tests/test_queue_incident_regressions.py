import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

from django.db import close_old_connections, connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.response import Response

from apps.inventory.models import InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import JobMaterialRequirement, PlannerOperation
from apps.production.services.planner_operations import entity_revision, planner_operation
from apps.production.services.services_execution import ExecutionService
from apps.production.tests import test_wcm_audit_events as fixtures
from apps.production.views_planner import PlannerViewSet
from apps.sales.models import SalesOrder, SalesOrderItem


def reject_writes(execute, sql, params, many, context):
    if re.search(r'\b(INSERT|UPDATE|DELETE|MERGE)\b|\bFOR\s+(UPDATE|SHARE|NO\s+KEY|KEY\s+SHARE)\b', sql, re.I):
        raise AssertionError('Display request attempted a write or row lock')
    return execute(sql, params, many, context)


class QueueDisplayRegressionTests(TestCase):
    setUp = fixtures.WcmAuditEventTests.setUp

    def attach_bom(self, quantity=25):
        order = SalesOrder.objects.create(customer_name='Projection regression', status='PLANNING_REQUIRED')
        item = SalesOrderItem.objects.create(sales_order=order, template=self.template, qty_value=100, unit_price=1,
            bom_snapshot={'planning_lines': [{'material_id': str(self.granule.id), 'step_id': str(self.step.id),
                'category_code': 'GRANULE', 'theoretical_qty': quantity, 'planned_issue_qty': quantity}]})
        self.job.sales_order_item = item
        self.job.save(update_fields=['sales_order_item'])
        return item

    def test_all_wcm_display_helpers_are_read_only_and_use_current_projection(self):
        self.attach_bom()
        self.requirement.consumed_qty = Decimal('3')
        self.requirement.save(update_fields=['consumed_qty'])
        with connection.execute_wrapper(reject_writes):
            profile = ExecutionService.get_step_execution_profile(self.job.id)
            status = ExecutionService.get_satisfaction_status(self.job.id)
            context = ExecutionService.get_job_context(self.job.id)
        self.assertEqual(profile['step_bulk_target_kg'], 25)
        self.assertEqual(status['bulk_consumption'][0]['required_qty'], 22)
        self.assertEqual(context['requirements'][0]['required_qty'], 25)
        self.requirement.refresh_from_db()
        self.assertEqual(self.requirement.required_qty, Decimal('10'))
        self.assertEqual(self.requirement.consumed_qty, Decimal('3'))

    def test_requirement_projection_queries_do_not_grow_per_material(self):
        item = self.attach_bom()
        materials = InventoryMaterial.objects.bulk_create([
            InventoryMaterial(code=f'PROJECTION-{i}', name=f'Projection {i}', category='GRANULE') for i in range(100)
        ])
        counts = []
        for size in (1, 100):
            item.bom_snapshot = {'planning_lines': [{'material_id': str(mat.id), 'step_id': str(self.step.id),
                'category_code': 'GRANULE', 'theoretical_qty': 10, 'planned_issue_qty': 11} for mat in materials[:size]]}
            item.save(update_fields=['bom_snapshot'])
            with connection.execute_wrapper(reject_writes), CaptureQueriesContext(connection) as queries:
                rows = ExecutionService.calculate_requirements(self.job.id, persist=False)
            self.assertEqual(len(rows), size)
            self.assertTrue(all(row.required_qty == 11 for row in rows))
            counts.append(len(queries))
        self.assertEqual(counts[0], counts[1])
        self.assertLessEqual(max(counts), 10)

    def test_full_bulk_availability_queries_do_not_grow_per_material(self):
        item = self.attach_bom()
        materials = InventoryMaterial.objects.bulk_create([
            InventoryMaterial(code=f'AVAILABILITY-{i}', name=f'Availability {i}', category='GRANULE') for i in range(100)
        ])
        counts = []
        for size in (1, 100):
            item.bom_snapshot = {'planning_lines': [{'material_id': str(mat.id), 'step_id': str(self.step.id),
                'category_code': 'GRANULE', 'theoretical_qty': 10, 'planned_issue_qty': 11} for mat in materials[:size]]}
            item.save(update_fields=['bom_snapshot'])
            with connection.execute_wrapper(reject_writes), CaptureQueriesContext(connection) as queries:
                status = ExecutionService.get_satisfaction_status(self.job.id)
            self.assertEqual(len(status['bulk_consumption']), size)
            self.assertTrue(all(row['required_qty'] == 11 for row in status['bulk_consumption']))
            counts.append(len(queries))
        self.assertEqual(counts[0], counts[1])
        self.assertLessEqual(max(counts), 32)

    def test_rejected_inventory_candidates_do_not_create_per_roll_queries(self):
        item = self.attach_bom()
        self.template.routing_rule = self.route
        self.template.save(update_fields=['routing_rule'])
        self.job.sales_order_item = item
        self.job.save(update_fields=['sales_order_item'])
        # The eligible roll is deliberately older than every rejected candidate.
        matching = InventoryRoll.objects.create(label_id='ELIGIBLE-OLDER', template=self.template, material=self.granule,
            created_by_job=self.job, sales_order_item=item, weight_kg=10, width_mm=500, location=self.location, meta_json={'spec_signature': 'wanted'})
        InventoryRoll.objects.bulk_create([InventoryRoll(label_id=f'REJECT-{i}', template=self.template, material=self.granule,
            created_by_job=self.job, sales_order_item=item, weight_kg=10, width_mm=500, location=self.location,
            meta_json={'spec_signature': 'other'}) for i in range(250)])
        view = PlannerViewSet()
        with connection.execute_wrapper(reject_writes), CaptureQueriesContext(connection) as queries:
            rows = view._eligible_inventory_for_order('sales', item.sales_order, self.template, 'wanted', '', 0, 0, {}, {}, sales_item=item)
        self.assertEqual([row['inventory_id'] for row in rows], [str(matching.id)])
        self.assertLessEqual(len(queries), 8)

    def test_new_projection_identity_matches_later_explicit_reconciliation(self):
        self.attach_bom()
        self.requirement.delete()
        first = ExecutionService.calculate_requirements(self.job.id, persist=False)
        second = ExecutionService.calculate_requirements(self.job.id, persist=False)
        saved = ExecutionService.calculate_requirements(self.job.id)
        self.assertEqual([row.id for row in first], [row.id for row in second])
        self.assertEqual([row.id for row in first], [row.id for row in saved])

    def test_queue_cursor_preserves_sibling_lines_when_earlier_rows_are_released(self):
        self.template.routing_rule = self.route
        self.template.save(update_fields=['routing_rule'])
        order = SalesOrder.objects.create(customer_name='Paged queue', status='PLANNING_REQUIRED')
        items = SalesOrderItem.objects.bulk_create([SalesOrderItem(sales_order=order, template=self.template,
            line_name=f'Paged line {i}', line_status='OPEN', qty_value=10, total_weight_kg=10, unit_price=1) for i in range(230)])
        def page(cursor=''):
            with connection.execute_wrapper(reject_writes):
                return PlannerViewSet()._control_hub_lightweight(planning_limit=100, active_limit=0, history_limit=0,
                    summary=True, compact_queue=True, queue_cursor=cursor).data
        first = page()
        self.assertEqual(len(first['orders']), 100)
        first_ids = [row['sales_order_item_id'] for row in first['orders']]
        SalesOrderItem.objects.filter(id__in=first_ids[:50]).update(line_status='RELEASED')
        second = page(first['planning_page']['next_cursor'])
        third = page(second['planning_page']['next_cursor'])
        ids = first_ids + [row['sales_order_item_id'] for row in second['orders'] + third['orders']]
        self.assertEqual(len(ids), 230)
        self.assertEqual(len(set(ids)), 230)
        self.assertFalse(third['planning_page']['has_more'])
        self.assertTrue(all(row['detail_required_for_release'] for row in first['orders']))
        self.assertLess(len(json.dumps(first, default=str)), 650_000)


class PlannerReceiptTests(TestCase):
    setUp = fixtures.WcmAuditEventTests.setUp

    def prepare(self):
        self.order = SalesOrder.objects.create(customer_name='Receipt regression', status='PLANNING_REQUIRED')
        self.item = SalesOrderItem.objects.create(sales_order=self.order, template=self.template, qty_value=10, unit_price=1)
        self.calls = Mock()

        @planner_operation('plan')
        def handler(_view, _request, **_kwargs):
            self.calls()
            self.item.line_status = 'PLANNED'
            self.item.save(update_fields=['line_status'])
            return Response({'status': 'planned'})
        self.handler = handler
        self.payload = {'item_id': str(self.item.id), 'operation_id': str(uuid.uuid4()),
                        'expected_revision': entity_revision('sales', self.item)}

    def request(self, data=None, user=None):
        return SimpleNamespace(data=data or self.payload, headers={}, user=user or self.user)

    def test_retry_returns_original_committed_response(self):
        self.prepare()
        one = self.handler(None, self.request(), order_kind='sales', order_id=str(self.order.id))
        two = self.handler(None, self.request(), order_kind='sales', order_id=str(self.order.id))
        self.assertEqual(one.data, two.data)
        self.assertTrue(two.data['committed'])
        self.assertEqual(two['Idempotency-Replayed'], 'true')
        self.assertEqual(self.calls.call_count, 1)
        self.assertEqual(PlannerOperation.objects.count(), 1)

    def test_old_revision_and_reused_token_cannot_mutate(self):
        self.prepare()
        self.item.line_status = 'CANCELLED'
        self.item.save(update_fields=['line_status'])
        stale = self.handler(None, self.request(), order_kind='sales', order_id=str(self.order.id))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.calls.call_count, 0)
        self.item.line_status = 'OPEN'
        self.item.save(update_fields=['line_status'])
        self.payload['expected_revision'] = entity_revision('sales', self.item)
        self.handler(None, self.request(), order_kind='sales', order_id=str(self.order.id))
        other = self.handler(None, self.request({**self.payload, 'option': 'different'}), order_kind='sales', order_id=str(self.order.id))
        self.assertEqual(other.status_code, 409)
        self.assertEqual(self.calls.call_count, 1)

    def test_failed_operation_rolls_back_business_changes_and_receipt(self):
        self.prepare()
        @planner_operation('plan')
        def fail(_view, _request, **_kwargs):
            SalesOrderItem.objects.filter(pk=self.item.pk).update(line_status='PLANNED')
            return Response({'error': 'release gate blocked'}, status=400)
        response = fail(None, self.request(), order_kind='sales', order_id=str(self.order.id))
        self.assertEqual(response.status_code, 400)
        self.item.refresh_from_db()
        self.assertNotEqual(self.item.line_status, 'PLANNED')
        self.assertFalse(PlannerOperation.objects.exists())


class WcmParallelReadTests(TransactionTestCase):
    setUp = fixtures.WcmAuditEventTests.setUp
    attach_bom = QueueDisplayRegressionTests.attach_bom

    def test_parallel_display_reads_and_requirement_writes_do_not_deadlock(self):
        self.attach_bom(10)
        gate = Barrier(4)
        job_id = self.job.id
        readers = [ExecutionService.get_step_execution_profile, ExecutionService.get_satisfaction_status, ExecutionService.get_job_context]
        def exercise(index):
            close_old_connections()
            try:
                gate.wait(timeout=10)
                for _ in range(20):
                    with transaction.atomic():
                        with connection.cursor() as cursor:
                            cursor.execute("SET LOCAL statement_timeout = '5s'")
                            cursor.execute("SET LOCAL lock_timeout = '2s'")
                            if index < 3:
                                cursor.execute('SET TRANSACTION READ ONLY')
                        if index < 3:
                            with connection.execute_wrapper(reject_writes):
                                readers[index](job_id)
                        else:
                            ExecutionService.calculate_requirements(job_id)
                return 20
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(exercise, range(4))), [20] * 4)
        self.requirement.refresh_from_db()
        self.assertEqual(self.requirement.required_qty, Decimal('10'))
