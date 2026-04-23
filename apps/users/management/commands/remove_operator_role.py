from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import MachineAssignment, Role, User


class Command(BaseCommand):
    help = "Delete legacy OPERATOR users and direct machine assignments after exporting a simple backup summary."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Actually delete OPERATOR users, OPERATOR role rows, and direct machine assignments.",
        )

    def handle(self, *args, **options):
        operator_roles = Role.objects.filter(code="OPERATOR")
        operator_users = User.objects.filter(role__code="OPERATOR")
        machine_assignments = MachineAssignment.objects.all()

        self.stdout.write("Legacy OPERATOR cleanup summary")
        self.stdout.write(f"operator_roles={operator_roles.count()}")
        self.stdout.write(f"operator_users={operator_users.count()}")
        self.stdout.write(f"machine_assignments={machine_assignments.count()}")

        for user in operator_users.order_by("username").values("id", "username", "email"):
            self.stdout.write(f"user={user['id']} username={user['username']} email={user['email']}")

        if not options["confirm"]:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --confirm to delete."))
            return

        with transaction.atomic():
            deleted_assignments, _ = machine_assignments.delete()
            deleted_users, _ = operator_users.delete()
            deleted_roles, _ = operator_roles.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted machine_assignments={deleted_assignments}, operator_users={deleted_users}, operator_roles={deleted_roles}"
            )
        )
