"""Shared Redis cache that degrades instead of failing requests.

Login throttling, rate limits, lockouts and short-lived dashboard caches must
be shared by every gunicorn worker (an in-process cache gives each worker its
own counters and forgets them on every worker recycle). Redis provides that.
If Redis is briefly unavailable, cache reads behave as misses and writes are
dropped, so the ERP keeps serving requests; rate limiting is simply relaxed
until Redis is back. Failures are logged at most once a minute per process.
"""
import logging
import time

from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.redis import RedisCache

logger = logging.getLogger(__name__)
_LOG_INTERVAL_SECONDS = 60


class ResilientRedisCache(RedisCache):
    _last_failure_log = 0.0

    def _failed(self, operation, exc):
        now = time.monotonic()
        if now - ResilientRedisCache._last_failure_log >= _LOG_INTERVAL_SECONDS:
            ResilientRedisCache._last_failure_log = now
            logger.warning("Cache %s failed; continuing without the shared cache: %s", operation, exc)

    def get(self, key, default=None, version=None):
        try:
            return super().get(key, default, version)
        except Exception as exc:
            self._failed("get", exc)
            return default

    def get_many(self, keys, version=None):
        try:
            return super().get_many(keys, version)
        except Exception as exc:
            self._failed("get_many", exc)
            return {}

    def set(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        try:
            return super().set(key, value, timeout, version)
        except Exception as exc:
            self._failed("set", exc)
            return None

    def set_many(self, data, timeout=DEFAULT_TIMEOUT, version=None):
        try:
            return super().set_many(data, timeout, version)
        except Exception as exc:
            self._failed("set_many", exc)
            return list(data)

    def add(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        try:
            return super().add(key, value, timeout, version)
        except Exception as exc:
            self._failed("add", exc)
            return False

    def incr(self, key, delta=1, version=None):
        try:
            return super().incr(key, delta, version)
        except ValueError:
            raise
        except Exception as exc:
            self._failed("incr", exc)
            raise ValueError("Cache unavailable") from exc

    def delete(self, key, version=None):
        try:
            return super().delete(key, version)
        except Exception as exc:
            self._failed("delete", exc)
            return False

    def touch(self, key, timeout=DEFAULT_TIMEOUT, version=None):
        try:
            return super().touch(key, timeout, version)
        except Exception as exc:
            self._failed("touch", exc)
            return False

    def has_key(self, key, version=None):
        try:
            return super().has_key(key, version)
        except Exception as exc:
            self._failed("has_key", exc)
            return False
