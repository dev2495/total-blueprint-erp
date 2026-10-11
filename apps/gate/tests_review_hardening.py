"""Visitor QR rotation and the per-gate hourly cap on self-registration."""
import uuid
from unittest.mock import patch

from django.test import TransactionTestCase
from rest_framework.test import APIClient

from apps.gate.models import GateAuditEvent, GatePublicLink, VisitorVisit
from apps.gate.tests import fixture


class VisitorQrHardeningTests(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, self.link, self.vendor, self.material = fixture()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.public = APIClient()

    def _visitor(self, token, mobile="9876543210"):
        return {"client_token": str(uuid.uuid4()), "gate_token": str(token), "name": "A Visitor", "mobile": mobile, "purpose": "Meeting", "consent": True}

    def test_owner_rotation_invalidates_the_printed_qr(self):
        old_token = self.link.token
        self.assertEqual(self.client.post("/api/gate/qr/rotate/", {"plant": str(self.plant.id), "reason": "no"}, format="json").status_code, 400)
        rotated = self.client.post("/api/gate/qr/rotate/", {"plant": str(self.plant.id), "reason": "QR photo shared on social media"}, format="json")
        self.assertEqual(rotated.status_code, 200, rotated.data)
        self.link.refresh_from_db()
        self.assertNotEqual(self.link.token, old_token)
        self.assertEqual(rotated.data["gate_token"], str(self.link.token))
        self.assertEqual(self.public.post("/api/gate/public/visitors/", self._visitor(old_token), format="json").status_code, 404)
        self.assertEqual(self.public.post("/api/gate/public/visitors/", self._visitor(self.link.token), format="json").status_code, 201)
        self.assertTrue(GateAuditEvent.objects.filter(object_type="QR_LINK", action="VISITOR_QR_ROTATED", actor=self.owner).exists())

    def test_watchman_cannot_rotate(self):
        watch = APIClient()
        watch.force_authenticate(self.watchman)
        self.assertEqual(watch.post("/api/gate/qr/rotate/", {"plant": str(self.plant.id), "reason": "Trying to rotate"}, format="json").status_code, 403)
        self.assertEqual(GatePublicLink.objects.get(plant=self.plant).token, self.link.token)

    def test_hourly_cap_per_gate(self):
        with patch("apps.gate.views.GATE_PUBLIC_HOURLY_CAP", 2):
            self.assertEqual(self.public.post("/api/gate/public/visitors/", self._visitor(self.link.token, "9876543210"), format="json").status_code, 201)
            self.assertEqual(self.public.post("/api/gate/public/visitors/", self._visitor(self.link.token, "9876543211"), format="json").status_code, 201)
            capped = self.public.post("/api/gate/public/visitors/", self._visitor(self.link.token, "9876543212"), format="json")
            self.assertEqual(capped.status_code, 429)
        self.assertEqual(VisitorVisit.objects.filter(plant=self.plant).count(), 2)
