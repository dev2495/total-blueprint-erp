from django.core.management.base import BaseCommand
from django.test import RequestFactory
from apps.production.views_planner import PlannerViewSet
from django.contrib.auth import get_user_model

class Command(BaseCommand):
    help = 'Test planner control_hub'

    def handle(self, *args, **options):
        User = get_user_model()
        admin = User.objects.filter(is_superuser=True).first()
        if not admin:
            self.stdout.write("No admin found.")
            return

        factory = RequestFactory()
        request = factory.get('/api/production/planner/control-hub/')
        request.user = admin

        view = PlannerViewSet.as_view({'get': 'control_hub'})
        
        try:
            response = view(request)
            self.stdout.write(f"STATUS: {response.status_code}")
            if hasattr(response, 'data'):
                data = response.data
                self.stdout.write(f"ORDERS: {len(data.get('orders', []))}")
                self.stdout.write(f"ACTIVE: {len(data.get('active_orders', []))}")
                self.stdout.write(f"HISTORY: {len(data.get('order_history', []))}")
        except Exception as e:
            import traceback
            self.stdout.write("EXCEPTION CAUGHT:")
            self.stdout.write(traceback.format_exc())
