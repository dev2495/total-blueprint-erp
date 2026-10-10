from django.core.exceptions import ValidationError
from django.db import transaction

from apps.factory.models import Machine, WorkCenter

from .models import User, Role, WorkCenterAssignment, MachineAssignment
from .permission_registry import DOCUMENT_PAGE_PERMISSIONS, DOCUMENT_PERMISSIONS, GATE_MASTER_PERMISSIONS, ROLE_PERMISSION_MATRIX, effective_permissions_for_role
from .role_catalog import canonicalize_role_matrix, get_canonical_role_code

# Landing for custom roles, in order of preference (permission, route).
CUSTOM_ROLE_LANDINGS = (
    ("page.inventory.gate_bills.view", "/inventory/gate-bills"),
    ("page.inventory.outward_documents.view", "/inventory/outward-documents"),
    ("inventory.view", "/inventory/rolls"),
)

# Document rights that include reading the bill register (documents.view).
VIEW_IMPLYING_DOCUMENT_PERMISSIONS = frozenset({"documents.upload", "documents.manage", "gatepass.manage"})


class PermissionService:
    @staticmethod
    def is_watchman(user) -> bool:
        actual = get_canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        effective = get_canonical_role_code(getattr(user, "effective_role_code", actual))
        return "WATCHMAN" in {actual, effective}

    @staticmethod
    def actual_account_permissions(user) -> set:
        """Grants of the real account: canonical matrix for its actual role, the
        Role matrix overrides (role.default_permissions) and user extras.
        Role previews and wildcards never add bill/document authority."""
        actual = get_canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        granted = set(effective_permissions_for_role(actual))
        granted.update(getattr(getattr(user, "role", None), "default_permissions", []) or [])
        granted.update(getattr(user, "extra_permissions", []) or [])
        granted.discard("*")
        return granted

    @staticmethod
    def has_inventory_bill_review(user) -> bool:
        """Stock-receipt authority against bills, from the real account only."""
        if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
            return False
        if PermissionService.is_watchman(user):
            return False
        if PermissionService.is_gate_master(user):
            return True
        actual = get_canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        actual_permissions = PermissionService.actual_account_permissions(user)
        can_receive = bool({"inventory.manage", "procurement.manage"} & actual_permissions)
        return can_receive and (actual == "STORE" or bool({"gate.bill.review", "documents.manage"} & actual_permissions))

    @staticmethod
    def has_document_permission(user, code: str) -> bool:
        """Bill & document rights (documents.*, gatepass.manage, outward.reconcile).

        Owner/Admin: always. Watchman: never. Everyone else: only what the real
        account is granted (Inventory/STORE by default, or a Role-matrix /
        user override). documents.view is implied by documents.upload,
        documents.manage and gatepass.manage. outward.reconcile alone does not
        open the inward bill register: it is the outward-photo matching right.
        """
        if code not in DOCUMENT_PERMISSIONS:
            raise ValueError(f"Unknown document permission: {code}")
        if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
            return False
        if PermissionService.is_watchman(user):
            return False
        if PermissionService.is_gate_master(user):
            return True
        granted = PermissionService.actual_account_permissions(user)
        if code in granted:
            return True
        return code == "documents.view" and bool(VIEW_IMPLYING_DOCUMENT_PERMISSIONS & granted)

    @staticmethod
    def document_entitlements(user) -> dict:
        return {code: PermissionService.has_document_permission(user, code) for code in sorted(DOCUMENT_PERMISSIONS)}

    @staticmethod
    def document_plants(user):
        """Bill & document scope is company-wide (for any document right), like inventory receipt scope.
        Callers still check the exact right (e.g. documents.view for bills, outward.reconcile for outward)."""
        from apps.factory.models import Plant

        holds = PermissionService.has_document_permission(user, "documents.view") or PermissionService.has_document_permission(user, "outward.reconcile")
        return Plant.objects.all() if holds else Plant.objects.none()

    @staticmethod
    def inventory_review_plants(user):
        """Current receipt APIs have global plant scope; preserve that authority."""
        from apps.factory.models import Plant

        return Plant.objects.all() if PermissionService.has_inventory_bill_review(user) else Plant.objects.none()

    @staticmethod
    def revoke_refresh_tokens(user: User) -> int:
        """Revoke this account's existing sessions without logging others out."""
        from django.utils import timezone
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        tokens = list(OutstandingToken.objects.filter(
            user=user, expires_at__gt=timezone.now(), blacklistedtoken__isnull=True,
        ))
        BlacklistedToken.objects.bulk_create(
            [BlacklistedToken(token=token) for token in tokens], ignore_conflicts=True,
        )
        return len(tokens)

    @staticmethod
    def is_gate_master(user) -> bool:
        """Actual master rights, with the watchman ceiling before every flag."""
        if not user or not getattr(user, "is_authenticated", False):
            return False
        actual = get_canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        effective = get_canonical_role_code(getattr(user, "effective_role_code", actual))
        if "WATCHMAN" in {actual, effective}:
            return False
        return bool(actual in {"ADMIN", "OWNER"} or getattr(user, "is_owner", False) or getattr(user, "is_superuser", False))

    @staticmethod
    def _normalize_id_list(values: list) -> list[str]:
        cleaned = []
        seen = set()
        for raw in values or []:
            value = str(raw or "").strip()
            if not value or value in seen:
                continue
            cleaned.append(value)
            seen.add(value)
        return cleaned

    @staticmethod
    def _to_permission_map(permissions: list[str]):
        permission_map = {}
        for permission in permissions:
            value = str(permission or "")
            if not value:
                continue
            if value == "*":
                permission_map["*"] = ["*"]
                continue
            module_key, _, action_key = value.partition(".")
            if not module_key:
                continue
            permission_map.setdefault(module_key, [])
            if action_key and action_key not in permission_map[module_key]:
                permission_map[module_key].append(action_key)

        for module_key, actions in permission_map.items():
            actions.sort()
        return permission_map

    @staticmethod
    def get_user_permissions(user: User):
        """
        Returns a set of all permission codes for the user.
        Respects effective_role_code for overrides.
        """
        perms = set()
        
        # Determine which role's permissions to use
        active_role_code = get_canonical_role_code(
            getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        )

        # Watchman is a closed operational role: stale role rows, user extras,
        # owner flags or preview headers must never expose other ERP modules.
        actual_role_code = get_canonical_role_code(user.role.code if user.role else "")
        if actual_role_code == "WATCHMAN" or active_role_code == "WATCHMAN":
            return effective_permissions_for_role("WATCHMAN")
        
        role_code = 'ADMIN' if active_role_code in {'ADMIN', 'SUPER_ADMIN'} or user.is_superuser else active_role_code
        actual_role = user.role
        if actual_role and actual_role.code == role_code:
            role = actual_role
        elif role_code and (actual_role or role_code != 'GUEST'):
            role = Role.objects.filter(code=role_code).first()
        else:
            # GUEST is only a display fallback for an unassigned account.
            # It must not load an unrelated role row or add a query to every
            # production board read; explicit account grants still apply.
            role = None
        if role:
            perms.update(role.default_permissions)

        # Always apply the canonical matrix as the baseline so newly added
        # permissions take effect on deploy without requiring a database re-sync.
        # The database can only extend beyond the matrix, never silently restrict it.
        if active_role_code:
            perms.update(effective_permissions_for_role(active_role_code))

        if user.extra_permissions:
            perms.update(user.extra_permissions)

        # Actual administrators/owners receive the complete gate pack by
        # default, independently of stale role rows or a non-watchman preview.
        if PermissionService.is_gate_master(user):
            perms.update(GATE_MASTER_PERMISSIONS)

        if PermissionService.has_inventory_bill_review(user):
            perms.update({"gate.bill.review", "notifications.view"})
        else:
            perms.discard("gate.bill.review")

        # Bill & document rights follow the real account (never a preview).
        documents = PermissionService.document_entitlements(user)
        for code, allowed in documents.items():
            if allowed:
                perms.add(code)
            else:
                perms.discard(code)
        for page, needs in DOCUMENT_PAGE_PERMISSIONS.items():
            if any(documents.get(code) for code in needs) or (page == "page.inventory.gate_bills.view" and PermissionService.has_inventory_bill_review(user)):
                perms.add(page)
            else:
                perms.discard(page)
        if any(documents.values()):
            perms.add("notifications.view")

        # Self-account actions must remain available across role matrix drifts.
        perms.add("users.self_manage")
            
        return list(perms)

    @staticmethod
    def get_assigned_context(user: User):
        """
        Returns { work_centers: [ids], machines: [ids] }
        """
        actual_role = get_canonical_role_code(user.role.code if user.role else "")
        effective_role = get_canonical_role_code(getattr(user, "effective_role_code", actual_role))
        if "WATCHMAN" in {actual_role, effective_role}:
            wc_ids, machine_ids = [], []
        else:
            wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))
            machine_ids = list(Machine.objects.filter(work_center_id__in=wc_ids).values_list('id', flat=True))
        
        from apps.gate.models import GateAssignment
        gate_plant_ids = list(GateAssignment.objects.filter(user=user).values_list("plant_id", flat=True))
        return {
            "work_centers": wc_ids,
            "machines": machine_ids,
            "gate_plants": gate_plant_ids,
        }

    @staticmethod
    def assign_gate_plants(user: User, plant_ids: list):
        from apps.factory.models import Plant
        from apps.gate.models import GateAssignment

        normalized = PermissionService._normalize_id_list(plant_ids)
        try:
            existing = {str(pk) for pk in Plant.objects.filter(id__in=normalized).values_list("id", flat=True)}
        except (ValidationError, ValueError, TypeError) as exc:
            raise ValidationError({"gate_plant_ids": ["Plant identifiers must be valid UUIDs."]}) from exc
        missing = sorted(set(normalized) - existing)
        if missing:
            raise ValidationError({"gate_plant_ids": [f"Unknown plant identifiers: {', '.join(missing)}"]})
        with transaction.atomic():
            GateAssignment.objects.filter(user=user).delete()
            GateAssignment.objects.bulk_create([GateAssignment(user=user, plant_id=pk) for pk in normalized])
        return {"gate_plant_ids": normalized, "count": len(normalized)}

    @staticmethod
    def assign_work_centers(user: User, wc_ids: list):
        normalized_wc_ids = PermissionService._normalize_id_list(wc_ids)
        role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()

        existing_wcs = set(
            str(pk) for pk in WorkCenter.objects.filter(id__in=normalized_wc_ids).values_list("id", flat=True)
        )
        missing_wcs = sorted(set(normalized_wc_ids) - existing_wcs)
        if missing_wcs:
            raise ValidationError(
                {
                    "work_center_ids": [
                        f"Unknown work_center_id values: {', '.join(missing_wcs)}"
                    ]
                }
            )

        assigned_machine_ids = [
            str(mid)
            for mid in MachineAssignment.objects.filter(user=user).values_list("machine_id", flat=True)
        ]
        if assigned_machine_ids and normalized_wc_ids:
            allowed_machine_ids = set(
                str(pk)
                for pk in Machine.objects.filter(
                    id__in=assigned_machine_ids,
                    work_center_id__in=normalized_wc_ids,
                ).values_list("id", flat=True)
            )
            invalid_machine_ids = sorted(set(assigned_machine_ids) - allowed_machine_ids)
            if invalid_machine_ids:
                invalid_codes = list(
                    Machine.objects.filter(id__in=invalid_machine_ids).values_list("code", flat=True)
                )
                messages = ["Assigned machines are outside the selected work center scope."]
                if invalid_codes:
                    messages.append(f"Invalid machine codes: {', '.join(sorted(invalid_codes))}")
                raise ValidationError(
                    {"machine_ids": messages}
                )

        with transaction.atomic():
            WorkCenterAssignment.objects.filter(user=user).delete()
            for wc_id in normalized_wc_ids:
                WorkCenterAssignment.objects.create(user=user, work_center_id=wc_id)

        return {
            "work_center_ids": normalized_wc_ids,
            "count": len(normalized_wc_ids),
        }

    @staticmethod
    def assign_machines(user: User, machine_ids: list):
        normalized_machine_ids = PermissionService._normalize_id_list(machine_ids)

        if normalized_machine_ids:
            raise ValidationError(
                {"machine_ids": ["Direct machine assignment has been removed. Assign work centers to Work Center Manager users; machines are inherited from those work centers."]}
            )

        with transaction.atomic():
            MachineAssignment.objects.filter(user=user).delete()
            for machine_id in normalized_machine_ids:
                # Use model save path so clean() validation is enforced.
                MachineAssignment.objects.create(user=user, machine_id=machine_id)

        return {
            "machine_ids": normalized_machine_ids,
            "count": len(normalized_machine_ids),
        }

    @staticmethod
    def get_entitlements(user: User):
        """
        Returns the full entitlement object for the frontend.
        """
        active_role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        if get_canonical_role_code(user.role.code if user.role else "") == "WATCHMAN":
            active_role_code = "WATCHMAN"
        permissions = PermissionService.get_user_permissions(user)
        permission_map = PermissionService._to_permission_map(permissions)
        
        return {
            "role": active_role_code,
            "permissions": permissions,
            "permission_map": permission_map,
            "module_permissions": [
                {"module": module_key, "actions": actions}
                for module_key, actions in sorted(permission_map.items(), key=lambda kv: kv[0])
            ],
            "context": PermissionService.get_assigned_context(user),
            "is_owner": user.is_owner and get_canonical_role_code(user.role.code if user.role else "") != "WATCHMAN",
            "gate_master": PermissionService.is_gate_master(user),
            "inventory_bill_review": PermissionService.has_inventory_bill_review(user),
            "inventory_bill_scope": "ALL_PLANTS" if PermissionService.has_inventory_bill_review(user) else "NONE",
            "documents": PermissionService.document_entitlements(user),
            "landing_page": PermissionService.get_landing_route(user)
        }

    @staticmethod
    def get_landing_route(user: User) -> str:
        # Use effective_role_code if available (set by RoleOverrideMiddleware)
        # This ensures that when emulating a role, the correct dashboard is returned
        code = get_canonical_role_code(getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST'))
        if get_canonical_role_code(user.role.code if user.role else "") == "WATCHMAN":
            code = "WATCHMAN"
            
        # IMPORTANT: These routes must exist in the Next.js app router.
        # Keep them aligned with:
        # - frontend_v2/src/middleware.ts (edge redirect)
        # - frontend_v2/src/components/auth-provider.tsx (fallback redirect)
        ROUTING_MAP = {
            # Admin / Owner
            'OWNER': '/dashboard/owner',
            'ADMIN': '/dashboard/admin',

            # Department dashboards
            'SALES': '/sales/orders',
            'ENGINEERING': '/engineering/artworks',

            # Production terminals
            'PLANNER': '/production/planner',
            'WORK_CENTER_MANAGER': '/production/work-center',

            # Ops dashboards
            'STORE': '/inventory/rolls',
            'DISPATCH': '/dashboard/logistics',
            'PLANT_MANAGER': '/analytics/kpis',
            'WATCHMAN': '/gate',
        }
        
        if code in ROUTING_MAP:
            return ROUTING_MAP[code]
        # A custom role made in the Role matrix (e.g. Accounts with bill
        # upload) opens the first workspace it can actually use, never the
        # admin console it cannot load.
        if PermissionService.is_gate_master(user):
            return '/dashboard/admin'
        granted = set(PermissionService.get_user_permissions(user))
        for permission, route in CUSTOM_ROLE_LANDINGS:
            if permission in granted:
                return route
        return '/dashboard/admin'

    @staticmethod
    def get_role_matrix():
        matrix = {}
        for role_code, defaults in ROLE_PERMISSION_MATRIX.items():
            role = Role.objects.filter(code=role_code).first()
            matrix[role_code] = {
                "default_permissions": list(defaults),
                "database_permissions": list((role.default_permissions or []) if role else []),
            }
        return canonicalize_role_matrix(matrix)

    @staticmethod
    def sync_default_permissions_from_matrix():
        """
        Upserts role defaults from canonical matrix.
        """
        updated = []
        for role_code, permissions in ROLE_PERMISSION_MATRIX.items():
            role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": role_code.title()})
            role.default_permissions = list(permissions)
            role.save(update_fields=["default_permissions"])
            updated.append(role_code)
        return updated

    @staticmethod
    def validate_entitlements(user: User):
        active_role_code = get_canonical_role_code(
            getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        )
        granted = set(PermissionService.get_user_permissions(user))
        expected = set(effective_permissions_for_role(active_role_code))
        return {
            "role": active_role_code,
            "granted_permissions": sorted(granted),
            "granted_permission_map": PermissionService._to_permission_map(sorted(granted)),
            "expected_baseline_permissions": sorted(expected),
            "expected_permission_map": PermissionService._to_permission_map(sorted(expected)),
            "missing_from_baseline": sorted(expected - granted),
            "extra_overrides": sorted(granted - expected),
            "signoff": PermissionService.get_role_signoff_status(active_role_code),
            "context": PermissionService.get_assigned_context(user),
        }

    @staticmethod
    def get_role_signoff_status(role_code: str):
        from .models import RoleVisibilitySignoff

        normalized_role = get_canonical_role_code(role_code)
        rows = RoleVisibilitySignoff.objects.filter(role_code=normalized_role)
        total = rows.count()
        approved = rows.filter(approved=True).count()
        pending = total - approved
        return {
            "role_code": normalized_role,
            "total": total,
            "approved": approved,
            "pending": pending,
            "ready": pending == 0 if total > 0 else False,
        }

    @staticmethod
    def validate_role_visibility_matrix():
        report = {}
        for role_code in ROLE_PERMISSION_MATRIX.keys():
            report[role_code] = PermissionService.get_role_signoff_status(role_code)
        return report

    @staticmethod
    def bootstrap_visibility_signoffs():
        from .models import RoleVisibilitySignoff

        created = 0
        for role_code, permissions in ROLE_PERMISSION_MATRIX.items():
            for permission in permissions:
                if permission == "*":
                    continue
                module_key, _, action_key = str(permission).partition(".")
                if not module_key or not action_key:
                    continue
                _, was_created = RoleVisibilitySignoff.objects.get_or_create(
                    role_code=role_code,
                    module_key=module_key,
                    action_key=action_key,
                    defaults={"approved": False},
                )
                if was_created:
                    created += 1
        return {"created_rows": created}
