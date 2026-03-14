
import os
import django
from django.db import connection

print("Setting up Django environment...")
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
print("Calling django.setup()...")
django.setup()
print("Django setup complete.")
try:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    print("DB Connection via Django successful!")
except Exception as e:
    print(f"DB Connection via Django failed: {e}")
