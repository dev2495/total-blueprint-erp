"""Who may act on which work centre and machine.

Work Center Managers see and act only on the work centres assigned to them on the Users page.
Machine operators see and act only on the machines assigned to them. Admin, owner and every
other role (planner, plant manager, store...) are not limited by assignment here; their role
permissions decide what they may do. An admin previewing a floor role keeps the full view.
"""

from __future__ import annotations

from typing import Iterable, Optional, Set

from rest_framework.exceptions import PermissionDenied

SCOPED_WC_ROLES = {"WORK_CENTER_MANAGER"}
OPERATOR_ROLE = "OPERATOR"
ADMIN_ROLES = {"ADMIN", "SUPER_ADMIN", "OWNER"}

NO_WORK_CENTRE = "No work centre is assigned to your account. Ask an admin to assign one on the Users page."
OUTSIDE_WORK_CENTRE = "This work centre is not assigned to you."
NO_MACHINE = "No machine is assigned to your account. Ask an admin to assign one on the Users page."
OUTSIDE_MACHINE = "This machine is not assigned to you."


def actual_role(user) -> str:
    from apps.users.role_catalog import get_canonical_role_code

    return get_canonical_role_code(getattr(getattr(user, "role", None), "code", "") or "")


def is_unscoped(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
        return True
    raw = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return raw in ADMIN_ROLES or actual_role(user) in ADMIN_ROLES


def is_operator(user) -> bool:
    return not is_unscoped(user) and actual_role(user) == OPERATOR_ROLE


def assigned_machine_ids(user) -> Set[str]:
    from apps.users.models import MachineAssignment

    return {str(pk) for pk in MachineAssignment.objects.filter(user=user).values_list("machine_id", flat=True)}


def work_centre_scope(user) -> Optional[Set[str]]:
    """None = every work centre; otherwise the ids this account may see and act on."""
    if is_unscoped(user):
        return None
    role = actual_role(user)
    if role == OPERATOR_ROLE:
        from apps.factory.models import Machine

        return {
            str(pk)
            for pk in Machine.objects.filter(id__in=assigned_machine_ids(user)).values_list("work_center_id", flat=True)
            if pk
        }
    if role in SCOPED_WC_ROLES:
        from apps.users.models import WorkCenterAssignment

        return {str(pk) for pk in WorkCenterAssignment.objects.filter(user=user).values_list("work_center_id", flat=True)}
    return None


def machine_scope(user) -> Optional[Set[str]]:
    """None = every machine; otherwise the machine ids this account may run."""
    if is_unscoped(user):
        return None
    role = actual_role(user)
    if role == OPERATOR_ROLE:
        return assigned_machine_ids(user)
    if role in SCOPED_WC_ROLES:
        from apps.factory.models import Machine

        wcs = work_centre_scope(user) or set()
        return {str(pk) for pk in Machine.objects.filter(work_center_id__in=wcs).values_list("id", flat=True)}
    return None


def ensure_work_centre(user, work_center_id) -> None:
    scope = work_centre_scope(user)
    if scope is None:
        return
    if not scope:
        raise PermissionDenied(NO_WORK_CENTRE)
    if str(work_center_id or "") not in scope:
        raise PermissionDenied(OUTSIDE_WORK_CENTRE)


def ensure_machine(user, machine_id) -> None:
    scope = machine_scope(user)
    if scope is None:
        return
    if not scope:
        raise PermissionDenied(NO_MACHINE if is_operator(user) else NO_WORK_CENTRE)
    if str(machine_id or "") not in scope:
        raise PermissionDenied(OUTSIDE_MACHINE)


def job_work_centre_ids(job) -> Set[str]:
    """Work centres a job belongs to: its own and any WC assignment it has."""
    ids = set()
    if getattr(job, "work_center_id", None):
        ids.add(str(job.work_center_id))
    try:
        from apps.production.models import WorkCenterAssignment

        ids.update(
            str(pk)
            for pk in WorkCenterAssignment.objects.filter(production_job=job).values_list("work_center_id", flat=True)
            if pk
        )
    except Exception:
        pass
    return ids


def ensure_job(user, job) -> None:
    scope = work_centre_scope(user)
    if scope is None or job is None:
        return
    if not scope:
        raise PermissionDenied(NO_WORK_CENTRE)
    if not (job_work_centre_ids(job) & scope):
        raise PermissionDenied(OUTSIDE_WORK_CENTRE)


def _row(model, pk):
    """The row with this id, or None for a missing or malformed id (the view answers those)."""
    from django.core.exceptions import ValidationError

    try:
        return model.objects.filter(id=pk).only("id", "work_center_id").first()
    except (ValidationError, ValueError, TypeError):
        return None


def _first(values: Iterable) -> Optional[str]:
    for value in values:
        if value not in (None, ""):
            return str(value)
    return None


class WorkCentreScopeMixin:
    """Refuse a request about a work centre, WC assignment or job outside the caller's scope.

    Set ``scope_pk`` to what the URL ``pk`` names ("job" or "assignment"), and list request body
    keys naming an assignment or job. The checks run before the action, so a refused request
    changes nothing.
    """

    scope_pk: Optional[str] = None
    scope_wc_kwarg: Optional[str] = None
    scope_assignment_keys = ("assignment_id",)
    scope_job_keys = ("job_id", "previous_job_id", "next_job_id", "production_job_id")
    # Reads on these viewsets stay open to every role that may call them (traceability).
    scope_reads = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = getattr(request, "user", None)
        if work_centre_scope(user) is None:
            return
        if not self.scope_reads and request.method in ("GET", "HEAD", "OPTIONS"):
            return
        from apps.production.models import ProductionJob, WorkCenterAssignment

        if self.scope_wc_kwarg and kwargs.get(self.scope_wc_kwarg):
            ensure_work_centre(user, kwargs[self.scope_wc_kwarg])

        pk = kwargs.get("pk")
        if pk and self.scope_pk == "job":
            job = _row(ProductionJob, pk)
            if job is not None:
                ensure_job(user, job)
        elif pk and self.scope_pk == "assignment":
            assignment = _row(WorkCenterAssignment, pk)
            if assignment is not None:
                ensure_work_centre(user, assignment.work_center_id)

        data = request.data if hasattr(request, "data") and isinstance(request.data, dict) else {}
        assignment_id = _first(data.get(key) for key in self.scope_assignment_keys)
        if assignment_id:
            assignment = _row(WorkCenterAssignment, assignment_id)
            if assignment is not None:
                ensure_work_centre(user, assignment.work_center_id)
        for key in self.scope_job_keys:
            job_id = data.get(key)
            if job_id:
                job = _row(ProductionJob, job_id)
                if job is not None:
                    ensure_job(user, job)
