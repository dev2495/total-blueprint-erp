import sys
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()

try:
    import apps.analytics.urls
    print("SUCCESS: URLs imported.")
    for p in apps.analytics.urls.urlpatterns:
        print(p, p.name)
except Exception as e:
    import traceback
    traceback.print_exc()
