from django.test import SimpleTestCase

from apps.factory.models import Process
from apps.factory.serializers import ProcessSerializer


class ProcessRollBehaviorImmutabilityTests(SimpleTestCase):
    def test_roll_behavior_cannot_change_after_create(self):
        process = Process(
            code="TST-PROC-IMMUTABLE",
            name="Test Process",
            description="test",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )

        serializer = ProcessSerializer(
            instance=process,
            data={"roll_behavior": "SPLIT"},
            partial=True,
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("roll_behavior", serializer.errors)

    def test_roll_behavior_same_value_is_allowed(self):
        process = Process(
            code="TST-PROC-IMMUTABLE-SAME",
            name="Test Process Same",
            description="test",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )

        serializer = ProcessSerializer(
            instance=process,
            data={"roll_behavior": "MODIFY_EXISTING", "description": "updated"},
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
