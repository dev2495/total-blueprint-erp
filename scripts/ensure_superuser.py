import os
import django
import sys

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.users.models import User, Role

def create_admin():
    print("🚀 Ensuring SuperAdmin exists...")
    
    # 1. Ensure SUPER_ADMIN role exists
    role, created = Role.objects.get_or_create(
        code='SUPER_ADMIN',
        defaults={
            'name': 'Super Administrator',
            'description': 'All-access super admin role (dev)',
            'default_permissions': ['*'],
        }
    )
    if created:
        print(f"✅ Created Role: {role.code}")
    
    # 2. Create Superuser
    username = 'admin'
    password = 'admin123'
    email = 'admin@blueprinterp.com'
    
    if not User.objects.filter(username=username).exists():
        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            role=role
        )
        user.is_owner = True
        user.save(update_fields=['is_owner'])
        print(f"✅ Created Superuser: {username} / {password}")
    else:
        user = User.objects.get(username=username)
        user.role = role
        user.is_staff = True
        user.is_superuser = True
        user.is_owner = True
        user.set_password(password)
        user.save()
        print(f"ℹ️ Superuser {username} updated (Role/Password/Perms ensured)")

if __name__ == "__main__":
    create_admin()
