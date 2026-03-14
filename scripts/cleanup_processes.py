import os
import sys
import django

# Add the project root to sys.path
sys.path.append(os.getcwd())

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Process

def cleanup():
    count = Process.objects.all().count()
    Process.objects.all().delete()
    print(f"Deleted {count} processes.")

if __name__ == "__main__":
    cleanup()
