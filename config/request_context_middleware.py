import uuid
import json
import logging
import os
import time

from django.db import connection

from .request_context import clear_request_context, set_request_context

logger = logging.getLogger(__name__)


class RequestContextMiddleware:
    """Injects request-id/user/role context for logs and response headers."""

    HEADER_NAME = "X-Request-ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get(self.HEADER_NAME, str(uuid.uuid4()))
        user_id = ""
        role = ""
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            user_id = str(getattr(user, "id", "") or "")
            role = str(getattr(getattr(user, "role", None), "code", "") or "")

        set_request_context(request_id=request_id, user_id=user_id, role=role)
        request.request_id = request_id
        started = time.perf_counter()
        sql_count, sql_seconds = 0, 0.0
        response = None
        previous_budgets = None
        path = request.path_info.rstrip('/')
        queue_read = request.method in {'GET', 'HEAD'} and any(
            path == prefix or path.startswith(prefix + '/') for prefix in (
                '/api/production/planner/control-hub', '/api/production/wc',
                '/api/production/planner/jobs', '/api/production/jobs',
                '/api/production/flow-engine', '/api/production/wc-allocation',
            ))

        def measure(execute, sql, params, many, context):
            nonlocal sql_count, sql_seconds
            sql_count += 1
            sql_started = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                sql_seconds += time.perf_counter() - sql_started

        try:
            if queue_read and connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_setting('statement_timeout'), current_setting('lock_timeout')")
                    previous_budgets = cursor.fetchone()
                    cursor.execute("SELECT set_config('statement_timeout', %s, false), set_config('lock_timeout', %s, false)",
                                   [os.getenv('QUEUE_SQL_TIMEOUT_MS', '4000'), os.getenv('QUEUE_LOCK_TIMEOUT_MS', '500')])
            with connection.execute_wrapper(measure):
                response = self.get_response(request)
            duration_ms = (time.perf_counter() - started) * 1000
            response[self.HEADER_NAME] = request_id
            response['X-App-Build'] = os.getenv('APP_BUILD_SHA', 'unknown')
            response['Server-Timing'] = f'app;dur={duration_ms:.1f}, sql;dur={sql_seconds * 1000:.1f};desc="{sql_count} queries"'
            if queue_read:
                logger.info('queue_request %s', json.dumps({
                    'method': request.method, 'path': request.path, 'status': response.status_code,
                    'duration_ms': round(duration_ms, 1), 'sql_count': sql_count, 'sql_ms': round(sql_seconds * 1000, 1),
                    'build': os.getenv('APP_BUILD_SHA', 'unknown'),
                }))
            return response
        finally:
            if previous_budgets is not None:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT set_config('statement_timeout', %s, false), set_config('lock_timeout', %s, false)", previous_budgets)
                except Exception:
                    # Never leak a queue-only timeout into a reused write connection.
                    connection.close()
            clear_request_context()
