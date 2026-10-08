from threading import Event, Thread
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from rest_framework.generics import GenericAPIView
from rest_framework.test import APIClient

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial
from apps.users.models import Role


@override_settings(STRICT_RBAC=True)
@skipUnlessDBFeature('has_select_for_update')
class TemplateMutationConcurrencyTests(TransactionTestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ENGINEERING', defaults={'name': 'Engineering'})
        self.user = get_user_model().objects.create_user(username='template-race-engineer', role=role)
        self.process = Process.objects.create(
            code='TEMPLATE-RACE', name='Template race process', input_form='BULK',
            output_form='ROLL', roll_behavior='CREATE_NEW',
        )
        plant = Plant.objects.create(code='TEMPLATE-RACE', name='Template race plant')
        work_center = WorkCenter.objects.create(plant=plant, code='RACE-WC', name='Race work center')
        WorkCenterProcess.objects.create(work_center=work_center, process=self.process)
        route = RoutingRule.objects.create(name='Template race route', ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name='Template mutation race', fg_type='ROLL', status='APPROVED', routing_rule=route,
        )
        self.step = TemplateProcessStep.objects.create(template=self.template, process=self.process, sequence_number=1)
        self.material = TemplateProcessStepMaterial.objects.create(
            template_step=self.step, source_kind='CATEGORY', category_code='GRANULE',
            consumption_basis='FIXED_KG', quantity_mode='KG', value=1,
        )
        self.detail_url = f'/api/templates/{self.template.pk}/'
        self.step_url = f'{self.detail_url}process-steps/{self.step.pk}/'

    def _worker(self, fn, results, key):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SET statement_timeout = '10s'")
            client = APIClient()
            client.force_authenticate(self.user)
            results[key] = fn(client)
        except BaseException as exc:
            results[key] = exc
        finally:
            connection.close()

    def _thread(self, fn, results, key):
        thread = Thread(target=self._worker, args=(fn, results, key), daemon=True)
        thread.start()
        return thread

    def _response(self, results, key, expected):
        result = results.get(key)
        self.assertNotIsInstance(result, BaseException, repr(result))
        self.assertIsNotNone(result, f'{key} did not finish')
        self.assertEqual(result.status_code, expected, getattr(result, 'data', None))

    def test_publish_committed_after_initial_read_rejects_stale_child_write(self):
        read_parent = Event()
        published = Event()
        results = {}
        original_get_object = GenericAPIView.get_object

        def pause_after_authorized_read(view):
            template = original_get_object(view)
            if view.action == 'process_step_material_detail':
                read_parent.set()
                if not published.wait(5):
                    raise AssertionError('Publication did not finish')
            return template

        material_url = f'{self.step_url}materials/{self.material.pk}/'
        with patch.object(GenericAPIView, 'get_object', pause_after_authorized_read):
            writer = self._thread(lambda client: client.put(material_url, {'value': 9}, format='json'), results, 'write')
            try:
                self.assertTrue(read_parent.wait(5), 'Writer did not read the approved parent')
                publisher = self._thread(lambda client: client.post(f'{self.detail_url}publish/', {}, format='json'), results, 'publish')
                publisher.join(8)
                self.assertFalse(publisher.is_alive(), 'Publication was blocked before the writer acquired its lock')
                self._response(results, 'publish', 200)
            finally:
                published.set()
                writer.join(8)
        self.assertFalse(writer.is_alive())
        self._response(results, 'write', 400)
        self.template.refresh_from_db()
        self.material.refresh_from_db()
        self.assertEqual(self.template.status, 'LIVE')
        self.assertEqual(self.material.value, 1)

    def test_publish_waits_for_authorized_child_edit_before_readiness(self):
        ready_to_save = Event()
        allow_save = Event()
        publish_started = Event()
        publish_finished = Event()
        results = {}
        original_save = TemplateProcessStep.save

        def pause_before_child_save(step, *args, **kwargs):
            if step.pk == self.step.pk and step.notes == 'Edited before publication':
                ready_to_save.set()
                if not allow_save.wait(5):
                    raise AssertionError('Child edit was not allowed to finish')
            return original_save(step, *args, **kwargs)

        def publish(client):
            publish_started.set()
            try:
                return client.post(f'{self.detail_url}publish/', {}, format='json')
            finally:
                publish_finished.set()

        with patch.object(TemplateProcessStep, 'save', pause_before_child_save):
            writer = self._thread(
                lambda client: client.put(self.step_url, {'notes': 'Edited before publication'}, format='json'),
                results, 'write',
            )
            publisher = None
            try:
                self.assertTrue(ready_to_save.wait(5), 'Writer did not reach its child write')
                publisher = self._thread(publish, results, 'publish')
                self.assertTrue(publish_started.wait(5))
                self.assertFalse(publish_finished.wait(0.3), 'Publication committed while an authorized child edit was pending')
            finally:
                allow_save.set()
                writer.join(8)
                if publisher is not None:
                    publisher.join(8)
        self.assertFalse(writer.is_alive())
        self.assertIsNotNone(publisher)
        self.assertFalse(publisher.is_alive())
        self._response(results, 'write', 200)
        self._response(results, 'publish', 200)
        self.template.refresh_from_db()
        self.step.refresh_from_db()
        self.assertEqual(self.template.status, 'LIVE')
        self.assertEqual(self.step.notes, 'Edited before publication')

    def test_denied_actor_does_not_acquire_template_row_lock(self):
        role, _ = Role.objects.get_or_create(code='SALES', defaults={'name': 'Sales'})
        user = get_user_model().objects.create_user(username='template-race-sales', role=role)
        client = APIClient()
        client.force_authenticate(user)

        with CaptureQueriesContext(connection) as queries:
            response = client.put(self.step_url, {'notes': 'Forbidden'}, format='json')

        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(any('FOR NO KEY UPDATE' in row['sql'].upper() for row in queries.captured_queries))
        self.step.refresh_from_db()
        self.assertEqual(self.step.notes, '')
