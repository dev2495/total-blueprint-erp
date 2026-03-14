from django.core.exceptions import ValidationError
from django.db import transaction

from apps.factory.models import Machine, WorkCenter

from .models import User, Role, WorkCenterAssignment, MachineAssignment
from .permission_registry import ROLE_PERMISSION_MATRIX, effective_permissions_for_role
from .role_catalog import canonicalize_role_matrix, get_canonical_role_code

class PermissionService:
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
        
        if active_role_code == 'ADMIN' or active_role_code == 'SUPER_ADMIN' or user.is_superuser:
            # Admins get everything for now, or fetch Admin role perms
            role = Role.objects.filter(code='ADMIN').first()
            if role:
                perms.update(role.default_permissions)
        elif active_role_code:
            role = Role.objects.filter(code=active_role_code).first()
            if role:
                perms.update(role.default_permissions)

        if not perms and active_role_code:
            # Canonical fallback matrix for deny-by-default mode.
            perms.update(effective_permissions_for_role(active_role_code))

        if user.extra_permissions:
            perms.update(user.extra_permissions)

        # Self-account actions must remain available across role matrix drifts.
        perms.add("users.self_manage")
            
        return list(perms)

    @staticmethod
    def get_assigned_context(user: User):
        """
        Returns { work_centers: [ids], machines: [ids] }
        """
        wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))
        machine_ids = list(MachineAssignment.objects.filter(user=user).values_list('machine_id', flat=True))
        
        return {
            "work_centers": wc_ids,
            "machines": machine_ids
        }

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

        if role_code == "OPERATOR" and len(normalized_wc_ids) != 1:
            raise ValidationError(
                {"work_center_ids": ["Operator must be assigned exactly one work center."]}
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
        role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
        assigned_wc_ids = [
            str(wc_id)
            for wc_id in WorkCenterAssignment.objects.filter(user=user).values_list("work_center_id", flat=True)
        ]

        if normalized_machine_ids and role_code != "OPERATOR":
            raise ValidationError(
                {"machine_ids": ["Machine assignment is allowed only for OPERATOR role users."]}
            )

        if role_code == "OPERATOR":
            if len(assigned_wc_ids) != 1:
                raise ValidationError(
                    {"work_center_ids": ["Operator must have exactly one assigned work center before assigning machines."]}
                )

            existing_machine_map = dict(
                Machine.objects.filter(id__in=normalized_machine_ids).values_list("id", "work_center_id")
            )
            missing_machine_ids = sorted(
                set(normalized_machine_ids) - {str(machine_id) for machine_id in existing_machine_map.keys()}
            )
            if missing_machine_ids:
                raise ValidationError(
                    {
                        "machine_ids": [
                            f"Unknown machine_id values: {', '.join(missing_machine_ids)}"
                        ]
                    }
                )

            operator_wc_id = str(assigned_wc_ids[0])
            cross_wc_machines = []
            for machine_id, wc_id in existing_machine_map.items():
                if str(wc_id) != operator_wc_id:
                    cross_wc_machines.append(str(machine_id))

            if cross_wc_machines:
                invalid_codes = list(
                    Machine.objects.filter(id__in=cross_wc_machines).values_list("code", flat=True)
                )
                messages = ["Operator machines must belong to the single assigned work center."]
                if invalid_codes:
                    messages.append(f"Out-of-scope machine codes: {', '.join(sorted(invalid_codes))}")
                raise ValidationError(
                    {"machine_ids": messages}
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
            "is_owner": user.is_owner,
            "landing_page": PermissionService.get_landing_route(user)
        }

    @staticmethod
    def get_landing_route(user: User) -> str:
        # Use effective_role_code if available (set by RoleOverrideMiddleware)
        # This ensures that when emulating a role, the correct dashboard is returned
        code = get_canonical_role_code(getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST'))
            
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
            'OPERATOR': '/production/machine-selector',

            # Ops dashboards
            'STORE': '/inventory/roll-explorer',
            'DISPATCH': '/dashboard/logistics',
            'PLANT_MANAGER': '/analytics/kpis',
        }
        
        return ROUTING_MAP.get(code, '/dashboard/admin')

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
