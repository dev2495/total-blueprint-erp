from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
import time
from django.contrib.auth import get_user_model
from django.db import connection, connections, close_old_connections, OperationalError
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from apps.production.models import ProductionJob, DeliveryChallan
from apps.routing.models import RoutingRule
from apps.production.tests import test_dispatch_reservation_guardrails as dispatch_fixtures
from apps.recipes.models import RecipeGrade
from apps.materials.product_spec import build_product_spec
from unittest.mock import patch
from apps.production.views_planner import PlannerViewSet


class ProductionBoardQueryTests(TestCase):
    setUp = dispatch_fixtures.DispatchReservationGuardrailTests.setUp
    _item = dispatch_fixtures.DispatchReservationGuardrailTests._item
    _order = dispatch_fixtures.DispatchReservationGuardrailTests._order

    def test_board_queries_remain_constant_and_reads_do_not_write(self):
        route = RoutingRule.objects.create(name='Query route', ordered_processes=[])
        _, item = self._order()
        ProductionJob.objects.bulk_create([ProductionJob(job_number=f'QUERY-{i}', routing_rule=route, sales_order_item=item,
            quantity=10, job_state='PLANNED') for i in range(500)])
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username='planner-query', extra_permissions=['production.view']))
        counts = []
        for size in (1, 100, 200):
            with CaptureQueriesContext(connection) as queries:
                response = client.get('/api/production/jobs/board/', {'page_size': size})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(len(response.data['results']), size)
            self.assertEqual(response.data['count'], 500)
            self.assertFalse(any(q['sql'].lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE')) for q in queries))
            counts.append(len(queries))
        # Includes three connection-budget setup/restore statements.
        self.assertLessEqual(max(counts), 7)
        self.assertEqual(len(set(counts)), 1)
        self.assertEqual(len(client.get('/api/production/jobs/').data['results']), 100)
        print('BOARD_QUERY_COUNTS', counts)

    def test_planner_board_batches_material_labels_and_preserves_job_facts(self):
        _, item = self._order()
        grade = RecipeGrade.objects.create(name='Board GP')
        item.layer_snapshot = [{'variant_id': str(self.material.id), 'grade_id': str(grade.id), 'thickness_micron': 40}]
        item.save(update_fields=['layer_snapshot'])
        ProductionJob.objects.bulk_create([ProductionJob(job_number=f'PLANNER-BOARD-{i}', template=self.roll_template,
            routing_rule=self.route, sales_order_item=item, quantity=10, job_state='COMPLETED') for i in range(180)])
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username='planner-board', extra_permissions=['production.view']))
        counts = []
        with patch('apps.production.services.job_services.JobService.runtime_skip_options_for_job', side_effect=AssertionError('board calculated actions')), \
             patch('apps.production.services.batch_route_service.RouteGraphService.route_payload_for_job', side_effect=AssertionError('board calculated graph')):
            for size in (1, 100, 180):
                with CaptureQueriesContext(connection) as queries:
                    response = client.get('/api/production/planner/jobs/', {'summary': 1, 'board': 1, 'limit': size, 'states': 'COMPLETED'})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(len(response.data), size)
                self.assertIn(self.material.code, response.data[0]['sales_order_line_label'])
                self.assertIn(grade.name.upper().replace(' ', ''), response.data[0]['sales_order_line_label'])
                self.assertNotIn('runtime_skip_options', response.data[0])
                counts.append(len(queries))
                self.assertFalse(any(q['sql'].lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE')) for q in queries))
        self.assertEqual(len(set(counts)), 1)
        self.assertLessEqual(max(counts), 8)
        rows = client.get('/api/production/planner/jobs/', {'summary': 1, 'limit': 1, 'states': 'COMPLETED'}).data
        self.assertIn('runtime_skip_options', rows[0])
        self.assertIn('route_node', rows[0])
        compact = client.get('/api/production/planner/jobs/', {'summary': 1, 'board': 1, 'limit': 1, 'states': 'COMPLETED'}).data[0]
        self.assertEqual(compact, {key: value for key, value in rows[0].items() if key not in {'runtime_skip_options', 'route_node'}})
        print('PLANNER_BOARD_QUERY_COUNTS', counts)

    def test_product_spec_reuses_resolved_layers_without_changing_labels(self):
        grade = RecipeGrade.objects.create(name='Spec GP')
        with CaptureQueriesContext(connection) as queries:
            spec = build_product_spec(layers=[{'variant_id': str(self.material.id), 'grade_id': str(grade.id), 'thickness_micron': 40}], qty_value=100, qty_uom='KG')
        self.assertEqual(len(queries), 2)
        self.assertIn(self.material.code, spec['display_label'])
        self.assertEqual(spec['layers'][0]['variant_code'], self.material.code)
        self.assertEqual(spec['layer_stack']['thickness_label'], '40')

    def test_material_read_failure_does_not_publish_a_fallback_product_label(self):
        with patch('apps.materials.models.InventoryMaterial.objects.filter', side_effect=OperationalError('read budget exceeded')):
            with self.assertRaises(OperationalError):
                build_product_spec(layers=[{'variant_id': str(self.material.id)}])

    def test_active_projection_preserves_line_classification(self):
        _, active_child = self._order(status='CONFIRMED')
        active_child.line_status = 'RELEASED'
        active_child.save(update_fields=['line_status'])
        _, parent_fallback = self._order(status='PLANNED')
        _, planning_only = self._order(status='CONFIRMED')
        for index, item in enumerate((active_child, parent_fallback)):
            ProductionJob.objects.create(job_number=f'ACTIVE-BOARD-{index}', routing_rule=self.route,
                template=self.roll_template, sales_order_item=item, quantity=100, job_state='RELEASED')
        active = PlannerViewSet()._control_hub_lightweight(planning_limit=0, active_limit=160, history_limit=0, summary=True, v2=True).data
        broad = PlannerViewSet()._control_hub_lightweight(planning_limit=1, active_limit=160, history_limit=0, summary=True, v2=True).data
        self.assertEqual(active['active_orders'], broad['active_orders'])
        self.assertEqual({row['sales_order_item_id'] for row in active['active_orders']}, {str(active_child.id)})
        # A planning-required child stays in planning even under a planned parent.
        self.assertNotIn(str(parent_fallback.id), {row['sales_order_item_id'] for row in active['active_orders']})
        self.assertNotIn(str(planning_only.id), {row['sales_order_item_id'] for row in active['active_orders']})


    def test_challan_order_labels_are_joined_in_one_query(self):
        order, _ = self._order()
        DeliveryChallan.objects.bulk_create([DeliveryChallan(dc_no=f'QUERY-DC-{i}', plant=self.plant, sales_order=order, customer_name='Query customer') for i in range(100)])
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username='dispatch-query', extra_permissions=['logistics.view']))
        with CaptureQueriesContext(connection) as queries:
            response = client.get('/api/production/challans/list_challans/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 100)
        self.assertTrue(all(row['so_number'] == order.order_number for row in response.data))
        sales_reads = [q for q in queries if 'sales_orders' in q['sql']]
        self.assertEqual(len(sales_reads), 1)
        print('CHALLAN_ORDER_LABEL_QUERIES', len(sales_reads))


class DispatchConcurrentReservationTests(TransactionTestCase):
    setUp = dispatch_fixtures.DispatchReservationGuardrailTests.setUp
    _item = dispatch_fixtures.DispatchReservationGuardrailTests._item
    _order = dispatch_fixtures.DispatchReservationGuardrailTests._order
    _roll = dispatch_fixtures.DispatchReservationGuardrailTests._roll
    _create_roll_challan = dispatch_fixtures.DispatchReservationGuardrailTests._create_roll_challan

    def test_reversed_overlapping_roll_selections_reserve_once_without_deadlock(self):
        order, item = self._order()
        rolls = [self._roll(item) for _ in range(10)]
        gate = Barrier(4)
        def reserve(reverse):
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute("SET statement_timeout = '10s'")
                gate.wait(timeout=5)
                try:
                    self._create_roll_challan(order, list(reversed(rolls)) if reverse else rolls)
                    return 'reserved'
                except ValueError:
                    return 'conflict'
            finally:
                connections.close_all()
        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(reserve, [False, True, False, True]))
        self.assertEqual(results.count('reserved'), 1)
        self.assertEqual(results.count('conflict'), 3)
        self.assertEqual(DeliveryChallan.objects.count(), 1)
        print('DISPATCH_RACE', json.dumps({'users': 4, 'rolls': 10, 'seconds': time.monotonic()-started, 'results': results}))

    def test_challan_packing_reads_are_batched(self):
        for count in (1, 20):
            order, item = self._order()
            rolls = [self._roll(item) for _ in range(count)]
            with CaptureQueriesContext(connection) as queries:
                self._create_roll_challan(order, rolls)
            pack_reads = [q for q in queries if 'SELECT' in q['sql'] and '"production_roll_dispatch_pack_records"' in q['sql']]
            self.assertEqual(len(pack_reads), 1)
            print('PACKING_READ_QUERIES', count, len(pack_reads))
