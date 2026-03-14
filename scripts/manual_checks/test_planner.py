import os, sys, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.production.views_planner import PlannerViewSet
from unittest.mock import Mock

req = Mock()
req.user.is_authenticated = True
try:
    res = PlannerViewSet().control_hub(req)
    print("SUCCESS")
    print("Orders count:", len(res.data.get("orders", [])))
except Exception as e:
    import traceback
    traceback.print_exc()
