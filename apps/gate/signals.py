"""Provision visitor QR identity alongside normal factory creation."""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.factory.models import Plant
from .models import GatePublicLink


@receiver(post_save, sender=Plant, dispatch_uid="gate.provision_plant_public_link")
def provision_plant_public_link(sender, instance, created, raw=False, using="default", **kwargs):
    if created and not raw:
        # Never rotate an existing public identity. Normal factory API creates
        # run under ATOMIC_REQUESTS, so plant and its QR commit together.
        GatePublicLink.objects.using(using).get_or_create(plant_id=instance.pk)
