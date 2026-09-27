from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
import time
from django.contrib.auth import get_user_model
from django.db import connection, connections, close_old_connections
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from apps.production.models import ProductionJob, DeliveryChallan
from apps.routing.models import RoutingRule
from apps.production.tests import test_dispatch_reservation_guardrails as dispatch_fixtures


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
        self.assertLessEqual(max(counts), 5)
        self.assertEqual(len(set(counts)), 1)
        self.assertEqual(len(client.get('/api/production/jobs/').data['results']), 100)
        print('BOARD_QUERY_COUNTS', counts)


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
