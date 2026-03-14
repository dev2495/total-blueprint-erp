
import os
import django
import sys
from decimal import Decimal
from django.db import transaction

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess, ProcessMaterialRule
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk, InventoryReservation
from apps.production.models import ProductionJob, JobMaterialRequirement
from apps.production.services.job_services import JobService
from apps.production.services.services_execution import ExecutionService
from apps.production.services.operator_service import OperatorService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial
from apps.routing.models import RoutingRule
from apps.materials.models import InventoryMaterial, ConsumableMaterial
from apps.users.models import User

def verify_phase_68():
    print("🚀 STARTING PHASE 68 VERIFICATION (Strict Execution Rules)...")
    
    try:
        with transaction.atomic():
            # 1. Setup Master Data
            print("\n--- 1. Setup Master Data ---")
            plant, _ = Plant.objects.get_or_create(code="PL-PH68", name="Phase 68 Plant")
            rm_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='RM', defaults={'name': 'RM Store'})
            wip_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='WIP', defaults={'name': 'Production Floor'})
            
            admin_user, _ = User.objects.get_or_create(username='admin_ph68', is_superuser=True)

            # Processes
            proc_ext, _ = Process.objects.get_or_create(code="EXTRUSION-68", defaults={"name": "Extrusion", "input_form": "BULK", "output_form": "ROLL"})
            proc_print, _ = Process.objects.get_or_create(code="PRINTING-68", defaults={"name": "Printing", "input_form": "ROLL", "output_form": "ROLL"})
            # Note: Printing creates new roll (modifies_existing_roll=False default)

            # Work Centers
            wc_ext, _ = WorkCenter.objects.get_or_create(code="WC-EXT-68", name="Extrusion Line", plant=plant, defaults={'default_wip_location': wip_loc})
            WorkCenterProcess.objects.get_or_create(work_center=wc_ext, process=proc_ext)
            
            wc_print, _ = WorkCenter.objects.get_or_create(code="WC-PRINT-68", name="Printing Press", plant=plant, defaults={'default_wip_location': wip_loc})
            WorkCenterProcess.objects.get_or_create(work_center=wc_print, process=proc_print)

            # Materials
            granule, _ = InventoryMaterial.objects.get_or_create(code="GRANULE-B", defaults={"name": "Granule B", "category": "GRANULE", "base_uom": "KG"})
            film_variant, _ = InventoryMaterial.objects.get_or_create(code="FILM-PH68", defaults={"name": "Test Film 68", "category": "FILM_VARIANT", "base_uom": "KG"})
            
            # 2. Template with Steps (Phase 71-compliant)
            print("\n--- 2. Create Template & Steps ---")
            routing_rule, _ = RoutingRule.objects.update_or_create(
                name="Phase 68 Flow",
                defaults={"ordered_processes": ["EXTRUSION-68", "PRINTING-68"]}
            )
            
            template, _ = TemplateBlueprint.objects.update_or_create(
                name="Phase 68 Template",
                defaults={
                    "fg_type": "ROLL",
                    "routing_rule": routing_rule,
                    "status": "LIVE",
                    "layer_schema": [{"variant_id": str(film_variant.id), "percentage": 100}]
                }
            )
            
            # Define Steps & Materials
            step1, _ = TemplateProcessStep.objects.get_or_create(
                template=template, sequence_number=1, defaults={'process': proc_ext}
            )
            # Step 1 input: Granule (Bulk)
            TemplateProcessStepMaterial.objects.get_or_create(
                template_step=step1, material=granule, defaults={'quantity_mode': 'KG', 'value': 1.05} # 1.05kg granule per 1kg output
            )
            
            step2, _ = TemplateProcessStep.objects.get_or_create(
                template=template, sequence_number=2, defaults={'process': proc_print}
            )
            # Step 2 input: Film (Roll)
            TemplateProcessStepMaterial.objects.get_or_create(
                template_step=step2, material=film_variant, defaults={'quantity_mode': 'KG', 'value': 1.0} # 1kg film per 1kg output
            )

            # 3. Create Order
            print("\n--- 3. Create Order & Jobs ---")
            so = SalesOrder.objects.create(order_number="SO-PH68-001", customer_name="Strict Customer")
            so_item = SalesOrderItem.objects.create(
                sales_order=so, template=template, qty_value=100, qty_uom="KG",
                layer_snapshot=[{"variant_id": str(film_variant.id), "percentage": 100}]
            )
            
            jobs = JobService.create_jobs_for_so_item(so_item)
            job_ext = jobs[0]
            job_print = jobs[1]
            
            JobService.release_job(job_ext.id)
            JobService.release_job(job_print.id)
            
            # Verify Requirements Created
            reqs_ext = JobMaterialRequirement.objects.filter(production_job=job_ext)
            print(f"Extrusion Requirements: {reqs_ext.count()}")
            
            reqs_print = JobMaterialRequirement.objects.filter(production_job=job_print)
            print(f"Printing Requirements: {reqs_print.count()}")
            assert reqs_print.exists(), "Printing job should have requirements explosoion"

            # 4. EXTRUSION Execution
            print("\n--- 4. Extrusion Execution ---")
            JobService.start_job(job_ext)
            
            print(f"DEBUG: RM Loc: {rm_loc.id}, WIP Loc: {wip_loc.id}")
            print(f"DEBUG: Job From: {job_ext.from_location_id}, WC Default: {job_ext.work_center.default_wip_location_id}")
            
            # Stock granule at correct location (WIP based on error log suggestion)
            target_loc = job_ext.from_location or job_ext.work_center.default_wip_location
            print(f"DEBUG: Stocking Granule at {target_loc.id}")
            
            InventoryBulk.objects.update_or_create(
                material=granule, location=target_loc,
                defaults={'qty_kg': 200.0, 'plant': plant}
            )
            
            # Complete Extrusion -> 100kg Roll
            OperatorService.complete_session(job_ext.id, 100.0, admin_user)
            
            roll_1 = InventoryRoll.objects.filter(production_job=job_ext).first()
            assert roll_1, "Extrusion Roll Created"
            print(f"✅ Created Roll: {roll_1.label_id}")

            # 5. PRINTING Execution (Strict Test)
            print("\n--- 5. Printing Execution (Strict Test) ---")
            
            # 5. PRINTING Execution (Strict Test)
            print("\n--- 5. Printing Execution (Strict Test) ---")
            
            # Stock Ink (Required for Printing)
            ink, _ = InventoryMaterial.objects.get_or_create(code="INK-CYAN-68", defaults={"name": "Cyan Ink", "category": "INK", "base_uom": "KG"})
            
            # Determine correct location for Printing Job Consumption
            target_loc_print = job_print.from_location or job_print.work_center.default_wip_location
            print(f"DEBUG: Stocking Ink {ink.id} at {target_loc_print.id}")
            print(f"DEBUG: Film ID: {film_variant.id}")
            
            InventoryBulk.objects.update_or_create(
                material=ink, location=target_loc_print,
                defaults={'qty_kg': 50.0, 'plant': plant}
            )
            
            # Verify Stock Exists
            exists = InventoryBulk.objects.filter(material=ink, location=target_loc_print).exists()
            print(f"DEBUG: Stock Exists? {exists}")
            
            # List Requirements
            print("DEBUG: Job Requirements:")
            for req in job_print.material_requirements.all():
                 print(f" - Req Mat: {req.material.id} ({req.material.name}), Cat: {req.material.category}, Qty: {req.required_qty}")
            # Add Ink Requirement to Job (as implicit logic might not have added it if not in Template)
            # NOTE: If the original run reported 2 reqs, one might be implicit or random. 
            # Let's ensure strict req exists.
            TemplateProcessStepMaterial.objects.get_or_create(
                template_step=step2, material=ink, defaults={'quantity_mode': 'KG', 'value': 0.05}
            )
            # Re-create requirements? No, job already created. 
            # Manually add Job Requirement if missing
            JobMaterialRequirement.objects.get_or_create(
                production_job=job_print, material=ink, process_step=step2, defaults={'required_qty': 5.0}
            )

            # Start Job
            JobService.start_job(job_print)
            
            # B. Check Satisfaction Status (Should be Satisfied due to Auto-Forwarding from Extrusion)
            status = ExecutionService.get_satisfaction_status(job_print.id)
            print(f"Satisfaction Status: {status['is_satisfied']} ({status['status_message']})")
            assert status['is_satisfied'], "Should be satisfied by Extrusion Roll (Auto-Forward)"
            
            # F. Complete Session -> Should SUCCEED (Validation of Auto-Forwarding)
            print("Completing Session with Auto-Forwarded inputs...")
            OperatorService.complete_session(job_print.id, 100.0, admin_user)
            
            print("✅ Session Completed Successfully (Auto-assigned inputs)")
            
            # 6. Verify Outputs
            # Input Roll Cleaned up?
            roll_1.refresh_from_db()
            print(f"Input Roll 1 Status: {roll_1.status}")
            assert roll_1.status == 'CONSUMED'
            
            # Output Roll Created?
            roll_2 = InventoryRoll.objects.filter(production_job=job_print).first()
            assert roll_2
            assert roll_2.id != roll_1.id
            print(f"Output Roll Created: {roll_2.label_id}")
            
            print("\n✨ PHASE 68 STRICT VERIFICATION SUCCESSFUL! ✨")

    except Exception as e:
        print(f"\n❌ VERIFICATION FAILED: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    verify_phase_68()
