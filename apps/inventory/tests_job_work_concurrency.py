"""Concurrent job-work returns on one order serialize on the order row lock."""
import threading
from decimal import Decimal

from django.db import close_old_connections
from django.test import TransactionTestCase

from apps.inventory.models import InventoryRoll, JobWorkReturn, JobWorkSettlement

from .tests_job_work_base import JobWorkFixtureMixin, token


class ConcurrentReturnTests(JobWorkFixtureMixin, TransactionTestCase):
    def _race(self, order_id, payloads):
        barrier = threading.Barrier(len(payloads))
        results = [None] * len(payloads)

        def worker(index, payload):
            try:
                client = self.client_for(self.store)
                barrier.wait(timeout=10)
                response = client.post(f"/api/inventory/job-work/{order_id}/returns/", payload, format="json")
                results[index] = (response.status_code, response.data)
            finally:
                close_old_connections()

        threads = [threading.Thread(target=worker, args=(index, payload)) for index, payload in enumerate(payloads)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
        return results

    def _order_with_roll(self, label):
        roll = self.make_roll(label, "50")
        order = self.create_order()
        sent = self.dispatch(order["id"], [roll])["order"]
        return order, sent["sent_lines"][0]["id"], roll

    def _payload(self, line_id, client_token=None):
        return {
            "client_token": client_token or token(),
            "sent_lines": [{"sent_line_id": line_id, "disposition": "PROCESSED"}],
            "output_rolls": [{"material_id": str(self.lam_film.id), "weight_kg": "48", "width_mm": "830", "thickness_micron": "30", "location_id": str(self.wip.id)}],
            "wastage": {"kg": "2"},
        }

    def test_two_different_returns_for_the_same_roll_post_once(self):
        order, line_id, roll = self._order_with_roll("PR-RACE-1")
        results = self._race(order["id"], [self._payload(line_id), self._payload(line_id)])
        codes = sorted(code for code, _ in results)
        self.assertEqual(codes, [201, 409], results)
        self.assertEqual(JobWorkReturn.objects.count(), 1)
        self.assertEqual(JobWorkSettlement.objects.count(), 1)
        self.assertEqual(InventoryRoll.objects.filter(material=self.lam_film).count(), 1)
        roll.refresh_from_db()
        self.assertEqual((roll.status, roll.weight_kg), ("CONSUMED", Decimal("0")))

    def test_same_token_sent_twice_at_once_posts_once_and_replays(self):
        order, line_id, _ = self._order_with_roll("PR-RACE-2")
        shared = self._payload(line_id, token())
        results = self._race(order["id"], [dict(shared), dict(shared)])
        codes = sorted(code for code, _ in results)
        self.assertEqual(codes, [200, 201], results)
        self.assertEqual(len({data["return_id"] for _, data in results}), 1)
        self.assertEqual(JobWorkReturn.objects.count(), 1)
