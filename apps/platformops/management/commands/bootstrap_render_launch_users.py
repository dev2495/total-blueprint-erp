from django.core.management.base import BaseCommand, CommandError

from apps.users.models import Role, User
from apps.users.permission_registry import effective_permissions_for_role
from apps.users.role_catalog import CANONICAL_ROLE_LABELS


def _ensure_role(role_code: str) -> Role:
    desired_name = CANONICAL_ROLE_LABELS.get(role_code, role_code.replace("_", " ").title())
    desired_permissions = effective_permissions_for_role(role_code)
    role, _ = Role.objects.get_or_create(
        code=role_code,
        defaults={
            "name": desired_name,
            "default_permissions": desired_permissions,
        },
    )

    changed_fields = []
    if role.name != desired_name:
        role.name = desired_name
        changed_fields.append("name")
    if list(role.default_permissions or []) != desired_permissions:
        role.default_permissions = desired_permissions
        changed_fields.append("default_permissions")
    if changed_fields:
        role.save(update_fields=changed_fields)
    return role


class Command(BaseCommand):
    help = (
        "Create or update the named Render go-live users without storing passwords in repo files. "
        "Devarsh is created as ADMIN; Chirag is created as OWNER."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Required safety flag for production-like environments.",
        )
        parser.add_argument("--devarsh-email", default="dvrshthakkar@gmail.com")
        parser.add_argument("--devarsh-username", default="")
        parser.add_argument("--devarsh-password", default="")
        parser.add_argument("--chirag-email", default="")
        parser.add_argument("--chirag-username", default="")
        parser.add_argument("--chirag-password", default="")

    def handle(self, *args, **options):
        if not options["allow_production"]:
            raise CommandError("Pass --allow-production to confirm you intend to create live users.")

        devarsh_password = str(options["devarsh_password"] or "").strip()
        chirag_email = str(options["chirag_email"] or "").strip()
        chirag_password = str(options["chirag_password"] or "").strip()
        if not devarsh_password:
            raise CommandError("--devarsh-password is required.")
        if not chirag_email:
            raise CommandError("--chirag-email is required.")
        if not chirag_password:
            raise CommandError("--chirag-password is required.")

        admin_role = _ensure_role("ADMIN")
        owner_role = _ensure_role("OWNER")

        self._upsert_user(
            username=str(options["devarsh_username"] or options["devarsh_email"]).strip(),
            email=str(options["devarsh_email"]).strip(),
            password=devarsh_password,
            first_name="Devarsh",
            last_name="Thakkar",
            role=admin_role,
            is_superuser=False,
            is_staff=True,
            is_owner=False,
        )
        self._upsert_user(
            username=str(options["chirag_username"] or chirag_email).strip(),
            email=chirag_email,
            password=chirag_password,
            first_name="Chirag",
            last_name="Gudhka",
            role=owner_role,
            is_superuser=False,
            is_staff=False,
            is_owner=True,
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Launch users are ready. Rotate both temporary passwords immediately after first login."
            )
        )

    def _upsert_user(
        self,
        *,
        username: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        role: Role,
        is_superuser: bool,
        is_staff: bool,
        is_owner: bool,
    ):
        if not username:
            raise CommandError("A non-empty username is required.")
        if not email:
            raise CommandError(f"{username}: email is required.")

        user = User.objects.filter(username=username).first() or User.objects.filter(email=email).first()
        created = user is None
        if created:
            user = User(username=username, email=email)

        user.username = username
        user.email = email
        user.first_name = first_name
        user.last_name = last_name
        user.role = role
        user.is_superuser = is_superuser
        user.is_staff = is_staff
        user.is_owner = is_owner
        user.set_password(password)
        user.save()

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} {username}"))
