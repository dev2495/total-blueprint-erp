import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings_minimal')
django.setup()

from apps.mrp.models import MRPSuggestion
from apps.mrp.services import MRPService
from apps.users.models import User, Notification

# Find a valid PO suggestion
sug = MRPSuggestion.objects.filter(type='PURCHASE').first()
if sug:
    print(f"Testing draft PO creation for suggestion: {sug.id}")
    user = User.objects.filter(role__name='SUPER_ADMIN').first()
    
    # Store previous notification count
    prev_count = Notification.objects.filter(user=user).count()
    
    res = MRPService.create_suggestion_draft(sug, 'po', user)
    print(f"Result: {res}")
    
    new_count = Notification.objects.filter(user=user).count()
    print(f"New Notifications generated for Super Admin: {new_count - prev_count}")
    
    if new_count > prev_count:
        last_notif = Notification.objects.filter(user=user).order_by('-created_at').first()
        print(f"Notification Sent: {last_notif.title} -> {last_notif.message}")
        print("Done!")
else:
    print("No purchase suggestion found.")
