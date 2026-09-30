from unittest.mock import patch

from django.db import connection
from django.http import HttpResponse
from django.test import RequestFactory, TransactionTestCase

from config.request_context import get_request_context
from config.request_context_middleware import RequestContextMiddleware


class QueueRequestBudgetTests(TransactionTestCase):
    def budgets(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('statement_timeout'), current_setting('lock_timeout')")
            return cursor.fetchone()

    def test_read_budget_is_restored_before_next_write_request(self):
        previous = self.budgets()
        observed = []
        def handle(request):
            observed.append(self.budgets())
            return HttpResponse('ok')
        middleware = RequestContextMiddleware(handle)
        with patch.dict('os.environ', QUEUE_SQL_TIMEOUT_MS='1234', QUEUE_LOCK_TIMEOUT_MS='123', APP_BUILD_SHA='test-build'):
            response = middleware(RequestFactory().get('/api/production/planner/control-hub/'))
            self.assertEqual(observed[-1], ('1234ms', '123ms'))
            self.assertEqual(response['X-App-Build'], 'test-build')
            self.assertIn('1 queries', response['Server-Timing'])
            self.assertEqual(self.budgets(), previous)
            for path in ('/api/production/planner/jobs/', '/api/production/jobs/board/'):
                middleware(RequestFactory().get(path))
                self.assertEqual(observed[-1], ('1234ms', '123ms'))
                self.assertEqual(self.budgets(), previous)
            middleware(RequestFactory().post('/api/production/planner/control-hub/sales/order/plan/'))
            self.assertEqual(observed[-1], previous)
            middleware(RequestFactory().get('/api/production/planner/control-hub'))
            self.assertEqual(observed[-1], ('1234ms', '123ms'))
            self.assertEqual(self.budgets(), previous)
        self.assertEqual(get_request_context()['request_id'], '')

    def test_budget_and_context_are_restored_after_unhandled_error(self):
        previous = self.budgets()
        def fail(request):
            raise RuntimeError('display failed')
        with self.assertRaises(RuntimeError):
            RequestContextMiddleware(fail)(RequestFactory().get('/api/production/wc/'))
        self.assertEqual(self.budgets(), previous)
        self.assertEqual(get_request_context()['request_id'], '')
