import os
import django
import sys

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.users.models import Role, User
from apps.factory.models import Plant

def seed_users():
    print("🌱 Seeding Roles & Users...")
    
    roles_data = [
        {
            "name": "Super Admin",
            "role_code": "SUPER_ADMIN",
            "description": "Full system access",
            "perms": {"can_manage_users": True, "can_manage_factory": True, "can_create_sales_orders": True, "can_manage_production": True, "can_execute_jobs": True, "can_manage_inventory": True, "can_manage_tooling": True}
        },
        {
            "name": "Sales Executive",
            "role_code": "SALES",
            "description": "Sales order management",
            "perms": {"can_create_sales_orders": True}
        },
        {
            "name": "Production Manager",
            "role_code": "PRODUCTION_MANAGER",
            "description": "Overall production oversight",
            "perms": {"can_manage_production": True, "can_manage_factory": True}
        },
        {
            "name": "Work Center Manager",
            "role_code": "WC_MANAGER",
            "description": "Manages a specific work center",
            "perms": {"can_manage_production": True, "can_execute_jobs": True}
        },
        {
            "name": "Machine Operator",
            "role_code": "OPERATOR",
            "description": "Executes production jobs",
            "perms": {"can_execute_jobs": True}
        },
        {
            "name": "Inventory Manager",
            "role_code": "INVENTORY",
            "description": "Warehouse and stock management",
            "perms": {"can_manage_inventory": True}
        }
    ]

    for data in roles_data:
        role, created = Role.objects.get_or_create(
            role_code=data["role_code"],
            defaults={
                "name": data["name"],
                "description": data["description"],
                **data["perms"]
            }
        )
        if created:
            print(f"✅ Created role: {role.role_code}")

    # Create Superuser
    if not User.objects.filter(username="admin").exists():
        admin_role = Role.objects.get(role_code="SUPER_ADMIN")
        User.objects.create_superuser(
            username="admin",
            email="admin@erp.com",
            password="adminpassword",
            role=admin_role
        )
        print("✅ Created superuser: admin / adminpassword")

    # Create samples
    sample_users = [
        ("sales_user", "SALES"),
        ("prod_man", "PRODUCTION_MANAGER"),
        ("wc_man", "WC_MANAGER"),
        ("op_01", "OPERATOR"),
        ("inv_man", "INVENTORY")
    ]

    for username, rcode in sample_users:
        if not User.objects.filter(username=username).exists():
            u = User.objects.create_user(
                username=username,
                password="password123",
                role=Role.objects.get(role_code=rcode)
            )
            print(f"✅ Created user: {username} ({rcode})")

    print("✨ Seeding complete.")

if __name__ == "__main__":
    seed_users()
