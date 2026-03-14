from django.db import transaction
from django.core.exceptions import ValidationError
from .models import ProductionJob

class JobControlService:
    @staticmethod
    def hold_job(job_id, reason):
        """
        job_state -> PAUSED
        is_on_hold = True
        """
        with transaction.atomic():
            job = ProductionJob.objects.get(id=job_id)
            if job.job_state == 'COMPLETED':
                raise ValidationError("Cannot hold a completed job.")
            
            job.job_state = 'PAUSED'
            job.is_on_hold = True
            job.hold_reason = reason
            job.save()
            return job

    @staticmethod
    def release_job(job_id):
        """
        job_state -> RELEASED
        clears hold fields
        """
        with transaction.atomic():
            job = ProductionJob.objects.get(id=job_id)
            if job.job_state == 'CANCELLED':
                 raise ValidationError("Cannot release a cancelled job.")
            
            job.job_state = 'RELEASED'
            job.is_on_hold = False
            job.hold_reason = ""
            job.save()
            
            # Phase 60: Create/Prepare Work Center Assignment
            from .services.job_services import WCManagerService
            WCManagerService.prepare_job_for_wc(job)
            
            return job

    @staticmethod
    def reprioritize_job(job_id, priority):
        """
        Updates priority.
        Does NOT reorder routing.
        """
        with transaction.atomic():
            job = ProductionJob.objects.get(id=job_id)
            job.priority = priority
            job.save()
            return job

    @staticmethod
    def reschedule_job(job_id, planned_date):
        """
        Updates planned_date.
        """
        with transaction.atomic():
            job = ProductionJob.objects.get(id=job_id)
            job.planned_date = planned_date
            job.save()
            return job
