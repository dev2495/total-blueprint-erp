from unittest import mock

from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.redis import RedisCache
from django.test import SimpleTestCase

from config.cache_backends import ResilientRedisCache


def _cache(location="redis://127.0.0.1:1/1"):
    # Port 1 refuses connections, so every call reaches the failure path quickly.
    return ResilientRedisCache(location, {"TIMEOUT": 300, "OPTIONS": {"socket_connect_timeout": 0.2, "socket_timeout": 0.2}})


class ResilientRedisCacheTests(SimpleTestCase):
    def test_writes_without_a_timeout_use_the_configured_default(self):
        cache = _cache()
        for method, args in (("set", ("k", 1)), ("add", ("k", 1)), ("set_many", ({"k": 1},)), ("touch", ("k",))):
            with mock.patch.object(RedisCache, method, return_value=True) as parent:
                getattr(cache, method)(*args)
            timeout = parent.call_args.args[len(args)]
            self.assertIs(timeout, DEFAULT_TIMEOUT, method)
        self.assertEqual(cache.get_backend_timeout(DEFAULT_TIMEOUT), 300)

    def test_unreachable_redis_behaves_as_an_empty_cache(self):
        cache = _cache()
        self.assertEqual(cache.get("missing", "fallback"), "fallback")
        self.assertEqual(cache.get_many(["a", "b"]), {})
        self.assertIsNone(cache.set("k", 1, 30))
        self.assertEqual(cache.set_many({"a": 1}, 30), ["a"])
        self.assertFalse(cache.add("k", 1, 30))
        self.assertFalse(cache.delete("k"))
        self.assertFalse(cache.touch("k", 30))
        self.assertFalse(cache.has_key("k"))
        with self.assertRaises(ValueError):
            cache.incr("k")
