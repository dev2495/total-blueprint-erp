from django.test import SimpleTestCase

from apps.physics.geometry_override import (
    geometry_signature,
    normalize_geometry_override,
    sanitize_geometry_override,
)


class GeometryOverrideTests(SimpleTestCase):
    def test_sanitize_ignores_pod_keys(self):
        payload = {
            "width_mm": 220,
            "height_mm": 310,
            "pod_enabled": True,
            "pod_height_mm": 50,
            "adjustments": [{"name": "Trim", "value": 2, "impact": "WIDTH"}],
        }

        out = sanitize_geometry_override(payload)

        self.assertEqual(out["width_mm"], 220)
        self.assertEqual(out["height_mm"], 310)
        self.assertIn("adjustments", out)
        self.assertNotIn("pod_enabled", out)
        self.assertNotIn("pod_height_mm", out)

    def test_normalize_uses_override_but_keeps_template_pod(self):
        template_geometry = {
            "base": {"width_mm": 180, "height_mm": 250},
            "pod_type": "DOUBLE",
            "adjustments": [{"name": "Legacy", "value": 1, "impact": "WIDTH"}],
        }
        override = {
            "width_mm": 200,
            "height_mm": 300,
            "pod_type": "NONE",  # should be ignored
            "adjustments": [{"name": "Width+", "value": 5, "impact": "WIDTH"}],
        }

        normalized = normalize_geometry_override(template_geometry, override)

        self.assertEqual(normalized["base"]["width_mm"], 200)
        self.assertEqual(normalized["base"]["height_mm"], 300)
        self.assertEqual(normalized.get("pod_type"), "DOUBLE")
        self.assertEqual(len(normalized.get("adjustments", [])), 1)

    def test_signature_changes_when_geometry_changes(self):
        template_geometry = {"base": {"width_mm": 100, "height_mm": 200}, "adjustments": []}

        sig_a = geometry_signature(template_geometry, {"width_mm": 100, "height_mm": 200, "adjustments": []})
        sig_b = geometry_signature(template_geometry, {"width_mm": 101, "height_mm": 200, "adjustments": []})

        self.assertNotEqual(sig_a, sig_b)
