from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import TemplateBlueprint


class TemplateGovernanceService:
    @staticmethod
    def lock_field(template_id: str, field_name: str):
        # Legacy lock model removed in V2 hard-cut.
        return None

    @staticmethod
    def unlock_field(template_id: str, field_name: str):
        # Legacy lock model removed in V2 hard-cut.
        return None

    @staticmethod
    def set_routing(template_id: str, routing_rule_id: str):
        template = TemplateBlueprint.objects.get(id=template_id)
        if template.status == "LIVE":
            raise ValidationError("Cannot change routing on a LIVE template.")
        template.routing_rule_id = routing_rule_id
        template.save(update_fields=["routing_rule"])

    @staticmethod
    def approve_template(template_id: str, user):
        template = TemplateBlueprint.objects.get(id=template_id)
        if not template.routing_rule_id:
            raise ValidationError("Templates cannot be approved/live without a Routing Rule.")
        template.status = "LIVE"
        template.approved_by = user
        template.approved_at = timezone.now()
        template.save(update_fields=["status", "approved_by", "approved_at"])
        return template

    @staticmethod
    def publish_template(template_id: str):
        return TemplateGovernanceService.approve_template(template_id, None)
