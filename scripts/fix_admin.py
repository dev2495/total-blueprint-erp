from django.core.management.base import BaseCommand

def run():
    from apps.users.models import User, Role
    username = 'admin'
    password = 'admin123'
    
    # Ensure OWNER role exists
    owner_role, created = Role.objects.get_or_create(code='OWNER', defaults={
        'name': 'Owner',
        'description': 'System Owner'
    })
    
    u, created = User.objects.get_or_create(username=username, defaults={
        'email': 'admin@blueprint.com',
        'is_active': True
    })
    
    u.set_password(password)
    u.is_superuser = True
    u.is_staff = True
    u.is_owner = True
    u.role = owner_role
    u.save()
    
    print(f"Successfully configured user '{username}' with role OWNER and password '{password}'")

if __name__ == "__main__":
    import os, sys
    import django
    
    sys.path.append(os.getcwd())
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    run()
