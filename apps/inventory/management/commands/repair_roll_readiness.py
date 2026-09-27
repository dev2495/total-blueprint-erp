import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from apps.inventory.models import InventoryRoll, InventoryReservation, InventoryMaintenanceAudit
from apps.production.models import ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.users.models import User


class Command(BaseCommand):
    help = 'Preview explicit legacy job/roll reconciliation. --apply requires actor and reason; never runs from GET.'

    def add_arguments(self, parser):
        parser.add_argument('--job', action='append', default=[])
        parser.add_argument('--roll', action='append', default=[])
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--actor')
        parser.add_argument('--reason')

    def handle(self, *args, **options):
        if not options['job'] and not options['roll']:
            raise CommandError('Select at least one --job or --roll UUID.')
        def snapshot():
            return {
                'jobs': list(ProductionJob.objects.filter(pk__in=options['job']).values('id','job_number','job_state')),
                'rolls': list(InventoryRoll.objects.filter(pk__in=options['roll']).values('id','label_id','status','current_step_index','completed_step_index')),
                'reservations': list(InventoryReservation.objects.filter(Q(job_id__in=options['job']) | Q(roll_id__in=options['roll'])).values('id','roll_id','status')),
            }
        before = snapshot()
        if len(before['jobs']) != len(set(options['job'])) or len(before['rolls']) != len(set(options['roll'])):
            raise CommandError('A requested job or roll was not found.')
        if not options['apply']:
            self.stdout.write(json.dumps({'preview':True, 'state':before},default=str))
            return
        if not options['actor'] or not (options['reason'] or '').strip():
            raise CommandError('--apply requires --actor UUID and --reason.')
        actor = User.objects.get(pk=options['actor'])
        with transaction.atomic():
            jobs = list(ProductionJob.objects.select_for_update().filter(pk__in=options['job']).order_by('pk'))
            rolls = list(InventoryRoll.objects.select_for_update().filter(pk__in=options['roll']).order_by('pk'))
            before = snapshot()
            for job in jobs:
                ExecutionService.reconcile_assignment_reservations(job)
                ExecutionService.calculate_requirements(job.pk)
            for roll in rolls:
                ExecutionService._unlock_roll_if_stale_reserved(roll)
                meta=roll.meta_json or {}
                if roll.stage_index == 0 and (meta.get('is_remainder') or meta.get('roll_role') == 'REMAINDER'):
                    roll.current_step_index=0
                    roll.completed_step_index=0
                    roll.save(update_fields=['current_step_index','completed_step_index'])
            audit = InventoryMaintenanceAudit.objects.create(created_by=actor,reason=options['reason'],
                before=json.loads(json.dumps(before,default=str)),after=json.loads(json.dumps(snapshot(),default=str)))
        self.stdout.write(json.dumps({'applied':True,'audit_id':str(audit.pk)}))
