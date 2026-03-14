import time
from collections import defaultdict

from django.db.models import Count, Q, Sum, F
from django.utils import timezone
from apps.factory.models import Machine, WorkCenter
from apps.sales.models import SalesOrder, Customer, SalesOrderItem
from apps.production.models import ProductionJob, JobExecutionLog, ScrapLog
from apps.inventory.models import InventoryBulk, InventoryRoll, InventoryLocation
from apps.templates.models import TemplateBlueprint
from apps.artwork.models import Artwork
from apps.recipes.models import ExtrusionRecipe
from apps.users.permission_registry import can_with_wildcard
import logging

logger = logging.getLogger(__name__)

class DashboardService:
    @staticmethod
    def get_stats(user):
        try:
            # Phase 27: Use effective role code from RoleOverrideMiddleware
            role_code = getattr(user, 'effective_role_code', 'GUEST')
            
            # If actual role is ADMIN/OWNER, we may bypass filters in specific handlers
            is_master = user.is_owner or (user.role and user.role.code == 'ADMIN')
            
            methods = {
                'OWNER': DashboardService.get_owner_stats,
                'ADMIN': DashboardService.get_owner_stats,
                'SALES': DashboardService.get_sales_stats,
                'ENGINEERING': DashboardService.get_engineering_stats,
                'PLANNER': DashboardService.get_planner_stats,
                'WORK_CENTER_MANAGER': DashboardService.get_wcm_stats,
                'OPERATOR': DashboardService.get_operator_stats,
                'STORE': DashboardService.get_store_stats,
                'DISPATCH': DashboardService.get_dispatch_stats
            }
            
            handler = methods.get(role_code, DashboardService.get_guest_stats)
            return handler(user, bypass_filters=is_master)
        except Exception as e:
            logger.error(f"Error getting dashboard stats: {str(e)}", exc_info=True)
            return {
                "metrics": [],
                "recent_activity": [],
                "status": "error",
                "message": "Security override: Dashboard could not be compiled."
            }

    @staticmethod
    def get_owner_stats(user, bypass_filters=False):
        from apps.analytics.services import AnalyticsService
        stats = AnalyticsService.get_control_tower_stats()
        
        # Add keys that role-specific dashboards might expect
        stats['active_jobs'] = list(ProductionJob.objects.filter(job_state='EXECUTING').values('job_number', 'machine__name', 'quantity'))
        
        return stats

    @staticmethod
    def get_sales_stats(user, bypass_filters=False):
        try:
            today = timezone.now().date()
            orders_today = SalesOrder.objects.filter(created_at__date=today).count()
            pending_approval = SalesOrder.objects.filter(status='DRAFT').count()
            
            # Count orders instead of summing non-existent total_amount
            total_orders = SalesOrder.objects.count()
            volume_total = SalesOrderItem.objects.aggregate(total=Sum('total_weight_kg'))['total'] or 0
            
            recent_orders = SalesOrder.objects.order_by('-created_at')[:8].values(
                'id', 'order_number', 'customer_name', 'status'
            )
            
            return {
                 "metrics": [
                    {"label": "Orders Today", "value": orders_today, "unit": "Orders"}, 
                    {"label": "Pending Approval", "value": pending_approval, "unit": "Orders"},
                    {"label": "Total Orders", "value": total_orders, "unit": "All Time"},
                    {"label": "Total Volume", "value": round(float(volume_total), 1), "unit": "kg"},
                 ],
                 "recent_orders": list(recent_orders),
                 "customers": list(Customer.objects.annotate(orders=Count('sales_orders')).order_by('-orders')[:5].values('name', 'orders'))
            }
        except Exception as e:
            logger.error(f"Error in get_sales_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "Sales Status", "value": "Offline", "unit": "Error"}],
                "recent_orders": [],
                "customers": []
            }

    @staticmethod
    def get_engineering_stats(user, bypass_filters=False):
        # Engineering is usually global, but we check filters if any specific machine assignment existed
        draft_templates = TemplateBlueprint.objects.filter(status='DRAFT').count()
        artwork_pending = Artwork.objects.filter(status='PENDING_APPROVAL').count()
        recipes_count = ExtrusionRecipe.objects.count()

        return {
            "metrics": [
                {"label": "Draft Templates", "value": draft_templates, "unit": "Items"},
                {"label": "Artwork Pending", "value": artwork_pending, "unit": "Items"},
                {"label": "Active Recipes", "value": recipes_count, "unit": "Master"},
            ]
        }

    @staticmethod
    def get_planner_stats(user, bypass_filters=False):
        try:
            waiting = ProductionJob.objects.filter(job_state='WAITING').count()
            planned = ProductionJob.objects.filter(job_state='PLANNED').count()
            executing = ProductionJob.objects.filter(job_state='EXECUTING').count()
            
            from apps.analytics.services import KPIService
            metrics_data = KPIService.get_real_metrics()

            return {
                "metrics": [
                    {"label": "Jobs Waiting", "value": waiting, "unit": "Jobs"},
                    {"label": "Planned Volume", "value": planned, "unit": "Jobs"},
                    {"label": "Live Jobs", "value": executing, "unit": "Running"},
                    {"label": "Plant Utilization", "value": f"{metrics_data['utilization']}%", "unit": "Avg"},
                ],
                "machine_loads": list(ProductionJob.objects.values('machine__name').annotate(count=Count('id')).filter(job_state='EXECUTING'))
            }
        except Exception as e:
            logger.error(f"Error in get_planner_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "Planner Status", "value": "Limited", "unit": "Error"}],
                "machine_loads": []
            }

    @staticmethod
    def get_wcm_stats(user, bypass_filters=False):
        try:
            if bypass_filters:
                # Admin/Owner sees ALL work centers
                wc_filter = Q()
            else:
                wc_ids = user.assigned_work_centers.values_list('work_center_id', flat=True)
                wc_filter = Q(production_job__work_center_id__in=wc_ids)

            today = timezone.now().date()
            
            produced_today = JobExecutionLog.objects.filter(
                wc_filter,
                logged_at__date=today
            ).aggregate(total=Sum('quantity'))['total'] or 0

            scrap_today = ScrapLog.objects.filter(
                wc_filter,
                logged_at__date=today
            ).aggregate(total=Sum('quantity'))['total'] or 0
            
            scrap_percent = (float(scrap_today) / float(produced_today) * 100) if produced_today > 0 else 0
            
            if bypass_filters:
                active_jobs_qs = ProductionJob.objects.filter(job_state='EXECUTING')
            else:
                wc_ids = user.assigned_work_centers.values_list('work_center_id', flat=True)
                active_jobs_qs = ProductionJob.objects.filter(work_center_id__in=wc_ids, job_state='EXECUTING')

            active_jobs = list(active_jobs_qs.values('job_number', 'machine__name', 'quantity'))

            return {
                "metrics": [
                    {"label": "Output Today", "value": round(float(produced_today), 1), "unit": "kg"},
                    {"label": "Scrap Rate", "value": f"{round(scrap_percent, 1)}%", "unit": "Today"},
                    {"label": "Active Jobs", "value": len(active_jobs), "unit": "Machines"},
                ],
                "active_jobs": active_jobs,
                "is_global_view": bypass_filters
            }
        except Exception as e:
            logger.error(f"Error in get_wcm_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "WCM Status", "value": "Error", "unit": ""}],
                "active_jobs": [],
                "is_global_view": bypass_filters
            }

    @staticmethod
    def get_operator_stats(user, bypass_filters=False):
        try:
            if bypass_filters:
                # Admin/Owner sees ANY machine in Executing state (or specific machines if logic dictates)
                # For "Operator View" as Admin, we show all machines running
                machine_filter = Q()
                user_filter = Q() 
            else:
                machine_ids = user.assigned_machines.values_list('machine_id', flat=True)
                machine_filter = Q(machine_id__in=machine_ids)
                user_filter = Q(logged_by=user)

            running_jobs = list(ProductionJob.objects.filter(
                machine_filter, job_state='EXECUTING'
            ).values('job_number', 'machine__name', 'quantity', 'id'))
            
            today = timezone.now().date()
            shift_output = JobExecutionLog.objects.filter(
                user_filter, 
                logged_at__date=today
            ).aggregate(total=Sum('quantity'))['total'] or 0

            current_job = None
            if running_jobs:
                job_obj = ProductionJob.objects.get(id=running_jobs[0]['id'])
                produced = JobExecutionLog.objects.filter(production_job=job_obj).aggregate(total=Sum('quantity'))['total'] or 0
                target = job_obj.quantity
                current_job = {
                    "job_number": job_obj.job_number,
                    "target": float(target),
                    "produced": float(produced),
                    "progress": float(round((produced / target * 100), 1)) if target > 0 else 0,
                    "machine": job_obj.machine.name if job_obj.machine else "Unknown"
                }

            return {
                "metrics": [
                    {"label": "System Output" if bypass_filters else "My Output", "value": round(float(shift_output), 1), "unit": "kg"},
                    {"label": "Active Machines", "value": len(running_jobs), "unit": ""},
                ],
                "current_job": current_job,
                "is_global_view": bypass_filters
            }
        except Exception as e:
            logger.error(f"Error in get_operator_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "Terminal Status", "value": "Limited", "unit": ""}],
                "current_job": None,
                "is_global_view": bypass_filters
            }

    @staticmethod
    def get_store_stats(user, bypass_filters=False):
        try:
            # Phase 57: Use InventoryBulk + InventoryRoll for unified inventory
            from django.db.models import Sum
            bulk_quantity = InventoryBulk.objects.aggregate(total=Sum('qty_kg'))['total'] or 0
            roll_quantity = InventoryRoll.objects.filter(status='AVAILABLE').aggregate(total=Sum('weight_kg'))['total'] or 0
            total_quantity = float(bulk_quantity) + float(roll_quantity)
            active_locations = InventoryLocation.objects.filter(is_active=True).count()
            return {
                "metrics": [
                    {"label": "Bulk Items", "value": InventoryBulk.objects.count(), "unit": "SKUs"},
                    {"label": "Roll Items", "value": InventoryRoll.objects.filter(status='AVAILABLE').count(), "unit": "Rolls"},
                    {"label": "Total Quantity", "value": f"{round(total_quantity, 1)}", "unit": "kg"},
                    {"label": "Active Locations", "value": active_locations, "unit": "Bins"},
                ]
            }
        except Exception as e:
            logger.error(f"Error in get_store_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "Inventory", "value": "Offline", "unit": ""}]
            }

    @staticmethod
    def get_dispatch_stats(user, bypass_filters=False):
        try:
            from apps.production.models import PackingUnit
            ready_to_dispatch = PackingUnit.objects.filter(status='READY').count()
            return {
                "metrics": [
                    {"label": "Ready for Dispatch", "value": ready_to_dispatch, "unit": "Units"},
                    {"label": "Pending Challans", "value": "0", "unit": "Qty"},
                ]
            }
        except Exception as e:
            logger.error(f"Error in get_dispatch_stats: {str(e)}", exc_info=True)
            return {
                "metrics": [{"label": "Logistics", "value": "Error", "unit": ""}]
            }
        
    @staticmethod
    def get_guest_stats(user, bypass_filters=False):
        return {"status": "restricted", "message": "Guest users have no dashboard assignment."}

    @staticmethod
    def search_global(query):
        try:
            results = []
            orders = SalesOrder.objects.filter(
                Q(order_number__icontains=query) | Q(customer_name__icontains=query)
            )[:5]
            for o in orders:
                results.append({"type": "Order", "label": f"{o.order_number} - {o.customer_name}", "href": f"/sales/orders/{o.id}", "status": o.status})

            jobs = ProductionJob.objects.filter(job_number__icontains=query)[:5]
            for j in jobs:
                results.append({"type": "Job", "label": j.job_number, "href": f"/production/planning?job={j.id}", "status": j.job_state})
                
            return results
        except Exception as e:
            logger.error(f"Global search error: {str(e)}", exc_info=True)
            return []

    @staticmethod
    def _route_catalog():
        return [
            {"id": "route:/dashboard/admin", "type": "route", "label": "Admin Dashboard", "subtitle": "/dashboard/admin", "href": "/dashboard/admin", "required_permission": "dashboard.view"},
            {"id": "route:/system/users", "type": "route", "label": "User Management", "subtitle": "/system/users", "href": "/system/users", "required_permission": "users.view"},
            {"id": "route:/system/role-matrix", "type": "route", "label": "Role Matrix", "subtitle": "/system/role-matrix", "href": "/system/role-matrix", "required_permission": "rbac.view"},
            {"id": "route:/system/governance", "type": "route", "label": "Governance Console", "subtitle": "/system/governance", "href": "/system/governance", "required_permission": "rbac.view"},
            {"id": "route:/sales/orders", "type": "route", "label": "Sales Orders", "subtitle": "/sales/orders", "href": "/sales/orders", "required_permission": "sales.view"},
            {"id": "route:/sales/customers", "type": "route", "label": "Customers", "subtitle": "/sales/customers", "href": "/sales/customers", "required_permission": "sales.view"},
            {"id": "route:/production/planner", "type": "route", "label": "Planner Control Tower", "subtitle": "/production/planner", "href": "/production/planner", "required_permission": "production.view"},
            {"id": "route:/production/work-center", "type": "route", "label": "Work Center Terminal", "subtitle": "/production/work-center", "href": "/production/work-center", "required_permission": "production.view"},
            {"id": "route:/production/machine-selector", "type": "route", "label": "Machine Selector", "subtitle": "/production/machine-selector", "href": "/production/machine-selector", "required_permission": "production.view"},
            {"id": "route:/factory/work-centers", "type": "route", "label": "Work Centers Master", "subtitle": "/factory/work-centers", "href": "/factory/work-centers", "required_permission": "factory.view"},
            {"id": "route:/factory/machines", "type": "route", "label": "Machines Master", "subtitle": "/factory/machines", "href": "/factory/machines", "required_permission": "factory.view"},
            {"id": "route:/analytics", "type": "route", "label": "Analytics Hub", "subtitle": "/analytics", "href": "/analytics", "required_permission": "analytics.view"},
            {"id": "route:/analytics/kpis", "type": "route", "label": "KPI Dashboard", "subtitle": "/analytics/kpis", "href": "/analytics/kpis", "required_permission": "analytics.view"},
            {"id": "route:/dashboard/logistics", "type": "route", "label": "Dispatch Dashboard", "subtitle": "/dashboard/logistics", "href": "/dashboard/logistics", "required_permission": "inventory.view"},
        ]

    @staticmethod
    def _score_match(query_lc: str, *parts: str) -> int:
        best = 0
        for part in parts:
            value = str(part or "").lower()
            if not value:
                continue
            if value.startswith(query_lc):
                best = max(best, 120)
            elif query_lc in value:
                best = max(best, 90)
            elif query_lc.replace(" ", "") in value.replace(" ", ""):
                best = max(best, 70)
        return best

    @staticmethod
    def search_global_v2(query: str, user, limit: int = 30, requested_types: list[str] | None = None):
        started_at = time.perf_counter()
        requested_types = [str(t or "").strip().lower() for t in (requested_types or []) if str(t or "").strip()]
        type_filter = set(requested_types)
        query_lc = str(query or "").strip().lower()

        from apps.users.permission_service import PermissionService

        granted_permissions = set(PermissionService.get_user_permissions(user))
        context = PermissionService.get_assigned_context(user)
        effective_role = str(getattr(user, "effective_role_code", getattr(getattr(user, "role", None), "code", "")) or "").upper()
        is_admin_actor = bool(
            user.is_superuser
            or user.is_owner
            or effective_role in {"ADMIN", "OWNER", "SUPER_ADMIN"}
        )

        def has_permission(permission: str) -> bool:
            return can_with_wildcard(granted_permissions, permission)

        def include_type(type_key: str) -> bool:
            return not type_filter or type_key in type_filter

        results = []
        wc_scope_ids = [str(v) for v in context.get("work_centers", [])]
        machine_scope_ids = [str(v) for v in context.get("machines", [])]

        if include_type("route"):
            for route in DashboardService._route_catalog():
                required_permission = str(route.get("required_permission") or "")
                if required_permission and not has_permission(required_permission):
                    continue
                score = DashboardService._score_match(query_lc, route.get("label"), route.get("subtitle"))
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": route["id"],
                        "type": "route",
                        "group": "Navigate",
                        "label": route["label"],
                        "subtitle": route["subtitle"],
                        "href": route["href"],
                        "status": "",
                        "score": score + 10,
                    }
                )

        if include_type("order") and has_permission("sales.view"):
            order_qs = SalesOrder.objects.filter(
                Q(order_number__icontains=query) | Q(customer_name__icontains=query)
            ).order_by("-created_at")[:limit]
            for order in order_qs:
                score = DashboardService._score_match(query_lc, order.order_number, order.customer_name)
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": str(order.id),
                        "type": "order",
                        "group": "Orders",
                        "label": f"{order.order_number} - {order.customer_name}",
                        "subtitle": "Sales Order",
                        "href": f"/sales/orders/{order.id}",
                        "status": str(order.status or ""),
                        "score": score,
                    }
                )

        if include_type("customer") and has_permission("sales.view"):
            customer_qs = Customer.objects.filter(
                Q(name__icontains=query) | Q(code__icontains=query)
            ).order_by("name")[:limit]
            for customer in customer_qs:
                score = DashboardService._score_match(query_lc, customer.name, customer.code)
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": str(customer.id),
                        "type": "customer",
                        "group": "Master",
                        "label": f"{customer.name} ({customer.code})",
                        "subtitle": "Customer",
                        "href": f"/sales/customers?focus={customer.id}",
                        "status": str(customer.status or ""),
                        "score": score,
                    }
                )

        if include_type("job") and has_permission("production.view"):
            job_qs = ProductionJob.objects.filter(job_number__icontains=query).select_related("machine", "work_center")
            if not is_admin_actor:
                if machine_scope_ids or wc_scope_ids:
                    job_qs = job_qs.filter(
                        Q(machine_id__in=machine_scope_ids) | Q(work_center_id__in=wc_scope_ids)
                    )
                else:
                    job_qs = job_qs.none()
            job_qs = job_qs.order_by("-created_at")[:limit]
            for job in job_qs:
                machine_name = getattr(getattr(job, "machine", None), "name", "") or "Unassigned Machine"
                wc_name = getattr(getattr(job, "work_center", None), "name", "") or "Unassigned WC"
                score = DashboardService._score_match(query_lc, job.job_number, machine_name, wc_name)
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": str(job.id),
                        "type": "job",
                        "group": "Production",
                        "label": str(job.job_number or ""),
                        "subtitle": f"{wc_name} • {machine_name}",
                        "href": f"/production/planning?job={job.id}",
                        "status": str(job.job_state or ""),
                        "score": score,
                    }
                )

        if include_type("machine") and has_permission("factory.view"):
            machine_qs = Machine.objects.filter(Q(name__icontains=query) | Q(code__icontains=query)).select_related("work_center")
            if not is_admin_actor:
                if machine_scope_ids:
                    machine_qs = machine_qs.filter(id__in=machine_scope_ids)
                else:
                    machine_qs = machine_qs.none()
            machine_qs = machine_qs.order_by("name")[:limit]
            for machine in machine_qs:
                wc_name = getattr(getattr(machine, "work_center", None), "name", "") or "Unassigned WC"
                score = DashboardService._score_match(query_lc, machine.name, machine.code, wc_name)
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": str(machine.id),
                        "type": "machine",
                        "group": "Production",
                        "label": f"{machine.name} ({machine.code})",
                        "subtitle": f"Machine • {wc_name}",
                        "href": f"/production/machine/{machine.id}",
                        "status": str(machine.status or ""),
                        "score": score,
                    }
                )

        if include_type("work_center") and has_permission("factory.view"):
            wc_qs = WorkCenter.objects.filter(Q(name__icontains=query) | Q(code__icontains=query)).select_related("plant")
            if not is_admin_actor:
                if wc_scope_ids:
                    wc_qs = wc_qs.filter(id__in=wc_scope_ids)
                else:
                    wc_qs = wc_qs.none()
            wc_qs = wc_qs.order_by("name")[:limit]
            for wc in wc_qs:
                plant_code = getattr(getattr(wc, "plant", None), "code", "") or ""
                score = DashboardService._score_match(query_lc, wc.name, wc.code, plant_code)
                if score <= 0:
                    continue
                results.append(
                    {
                        "id": str(wc.id),
                        "type": "work_center",
                        "group": "Production",
                        "label": f"{wc.name} ({wc.code})",
                        "subtitle": f"Work Center • {plant_code}",
                        "href": f"/production/work-center/{wc.id}",
                        "status": "",
                        "score": score,
                    }
                )

        # Stable rank: higher score first, then label for deterministic ordering.
        results = sorted(results, key=lambda row: (-int(row.get("score", 0)), str(row.get("label", "")).lower()))
        results = results[:limit]

        counts_by_type = defaultdict(int)
        for row in results:
            counts_by_type[str(row.get("type") or "unknown")] += 1

        took_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "query": query,
            "took_ms": max(took_ms, 0),
            "counts_by_type": dict(sorted(counts_by_type.items(), key=lambda kv: kv[0])),
            "results": results,
        }
