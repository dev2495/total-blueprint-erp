from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from decimal import Decimal
from io import BytesIO
from unittest.mock import patch
from threading import Barrier

from django.db import connection, connections, IntegrityError, transaction
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from apps.inventory.tests import test_inventory_v36_api as stock_fixtures
from apps.inventory import tests_interplant_service as transfer_fixtures
from apps.production.tests import test_roll_allocation_batch as allocation_fixtures
from apps.inventory.models import InventoryRoll, InventoryReservation, DeliveryChallan, RollLabelExport
from apps.inventory.services.inter_plant import InterPlantService
from apps.production.services.services_execution import ExecutionService
from apps.production.services.roll_allocation_service import RollAllocationService


class InventoryReadinessTests(TestCase):
    setUp = stock_fixtures.InventoryV36ApiTests.setUp

    def roll(self, label, **kwargs):
        return InventoryRoll.objects.create(label_id=label, material=self.roll_material,
            location=self.location, plant=self.plant, thickness_micron=12, width_mm=500,
            weight_kg=10, **kwargs)

    def test_snapshot_counts_beyond_2000_without_writes_or_per_roll_rate_queries(self):
        InventoryRoll.objects.bulk_create([InventoryRoll(label_id=f'BULK-{i}', material=self.roll_material,
            location=self.location, plant=self.plant, thickness_micron=12, width_mm=500,
            weight_kg=10) for i in range(2005)])
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get('/api/inventory/snapshot/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['kpi']['rolls_count'], 2005)
        self.assertEqual(response.data['kpi']['total_kg'], 20050)
        writes = [q['sql'] for q in queries if q['sql'].lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'DELETE '))]
        self.assertEqual(writes, [])
        self.assertLess(len(queries), 20, len(queries))
        page = self.client.get('/api/inventory/rolls/v36/?limit=10&offset=2000')
        self.assertEqual(page.data['total'], 2005)
        self.assertEqual(len(page.data['items']), 5)

    def test_trace_ambiguous_reference_never_picks_newest_roll(self):
        one = self.roll('ERP-001', meta_json={'vendor_roll_label':'SUP-1'})
        self.roll('ERP-002', meta_json={'vendor_roll_label':'SUP-1'})
        response = self.client.get('/api/inventory/roll-trace/', {'q':'SUP-1'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(response.data['candidates']), 2)
        exact = self.client.get('/api/inventory/roll-trace/', {'q':str(one.pk)})
        self.assertEqual(exact.status_code, 200)
        self.assertEqual(exact.data['roll']['id'], str(one.pk))

    def test_each_roll_gets_one_label_and_reprinting_keeps_identity(self):
        from pypdf import PdfReader
        rolls = [self.roll(f'ERP-LABEL-{i}', meta_json={'vendor_roll_label':f'SUP-{i}'}) for i in range(2)]
        for _ in range(2):
            response = self.client.post('/api/inventory/rolls/labels/', {'roll_ids':[str(r.pk) for r in rolls]}, format='json')
            self.assertEqual(response.status_code, 200, response.content[:200])
            pdf = PdfReader(BytesIO(response.content))
            self.assertEqual(len(pdf.pages), 2)
            for page, roll in zip(pdf.pages, rolls):
                self.assertIn(roll.label_id, page.extract_text())
                self.assertAlmostEqual(float(page.mediabox.width), 288, places=2)
        self.assertEqual(RollLabelExport.objects.count(), 2)
        self.assertEqual(RollLabelExport.objects.first().snapshots[0]['id'], str(rolls[0].pk))
        self.assertEqual(InventoryRoll.objects.count(), 2)

    def test_invalid_label_set_is_atomic_and_requires_permission(self):
        roll = self.roll('LABEL-GUARD')
        response = self.client.post('/api/inventory/rolls/labels/', {'roll_ids':[str(roll.pk),'invalid']}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(RollLabelExport.objects.count(), 0)
        self.client.force_authenticate(user=None)
        response = self.client.post('/api/inventory/rolls/labels/', {'roll_ids':[str(roll.pk)]}, format='json')
        self.assertEqual(response.status_code, 401)


class TransferReadinessTests(TestCase):
    setUp = transfer_fixtures.InterPlantServiceTests.setUp
    _create_roll = transfer_fixtures.InterPlantServiceTests._create_roll

    def test_atomic_transfer_retry_and_changed_payload(self):
        roll = self._create_roll()
        creation = dict(from_plant_id=str(self.plant_a.pk), to_plant_id=str(self.plant_b.pk))
        dispatch = dict(roll_ids=[str(roll.pk)], target_location_id=str(self.b_wip.pk))
        first = InterPlantService.create_and_dispatch(request_key='retry-1', create_data=creation, dispatch_data=dispatch)
        retry = InterPlantService.create_and_dispatch(request_key='retry-1', create_data=creation, dispatch_data=dispatch)
        self.assertEqual(first.pk, retry.pk)
        self.assertEqual(DeliveryChallan.objects.count(), 1)
        self.assertEqual(first.items.count(), 1)
        with self.assertRaisesMessage(Exception, 'different items'):
            InterPlantService.create_and_dispatch(request_key='retry-1', create_data=creation, dispatch_data={**dispatch, 'roll_ids':[]})

    def test_invalid_dispatch_does_not_leave_draft(self):
        roll = self._create_roll()
        with self.assertRaisesMessage(Exception, 'destination plant'):
            InterPlantService.create_and_dispatch(request_key='bad-target',
                create_data=dict(from_plant_id=str(self.plant_a.pk), to_plant_id=str(self.plant_b.pk)),
                dispatch_data=dict(roll_ids=[str(roll.pk)], target_location_id=str(self.a_wip.pk)))
        self.assertEqual(DeliveryChallan.objects.count(), 0)
        roll.refresh_from_db()
        self.assertEqual(roll.location_id, self.a_wip.pk)


class ManualAllocationRaceTests(TransactionTestCase):
    setUp = allocation_fixtures.RollAllocationBatchTests.setUp
    _job = allocation_fixtures.RollAllocationBatchTests._job
    _roll = allocation_fixtures.RollAllocationBatchTests._roll

    def test_two_jobs_compete_for_one_roll_on_independent_connections(self):
        second = self._job('SECOND-RACE', quantity='100', target_width='500')
        barrier = Barrier(2)
        def reserve(job_id):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                ExecutionService.assign_roll_to_job(job_id, self.roll_a.pk, defer_slot_validation=True)
                return 'allocated'
            except ValueError:
                return 'conflict'
            finally:
                connections.close_all()
        with ExitStack() as stack:
            for method, result in [('_is_v2',False),('_is_roll_step_compatible',True),('_required_roll_count',1),
                                   ('_resolve_step_roll_spec',{}),('_build_step_target_specs',[]),('get_job_context',{})]:
                stack.enter_context(patch.object(ExecutionService, method, return_value=result))
            stack.enter_context(patch.object(RollAllocationService,'get_eligible_rolls',side_effect=lambda *a,**kw: InventoryRoll.objects.filter(status='AVAILABLE')))
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(reserve,[self.job.pk,second.pk]))
        self.assertCountEqual(results,['allocated','conflict'])
        self.assertEqual(InventoryReservation.objects.filter(roll=self.roll_a,status='ACTIVE').count(),1)

    def test_database_prevents_a_second_active_reservation(self):
        InventoryReservation.objects.create(job=self.job, roll=self.roll_a, material=self.material, quantity=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            InventoryReservation.objects.create(job=self.job, roll=self.roll_a, material=self.material, quantity=1)

    def test_context_and_tiered_candidate_reads_do_not_write(self):
        with CaptureQueriesContext(connection) as queries:
            ExecutionService.get_job_context(self.job.pk, reconcile_assignment=False)
            RollAllocationService.allocate_tiered(self.job)
        self.assertEqual([q['sql'] for q in queries if q['sql'].lstrip().upper().startswith(('UPDATE ','INSERT ','DELETE '))], [])
