"""Create synthetic gate acceptance fixtures in the named local QA database only."""
import json
import os
import secrets
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.factory.models import Plant
from apps.gate.models import GateAssignment, GatePublicLink
from apps.inventory.models import Vendor
from apps.materials.models import InventoryMaterial, ProductMaster
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderReceipt, PurchaseOrderReceiptLine
from apps.sales.models import Customer
from apps.users.models import Role, User


def run():
    if settings.DATABASES["default"]["NAME"] != "tpp_gate_dev_20261007":
        raise RuntimeError("Gate fixtures are restricted to the isolated local QA database.")
    output = Path(settings.BASE_DIR) / ".runtime" / "gate-qa.json"
    if output.exists():
        print("Local gate fixtures already available; credentials retained privately.")
        return
    data = {}
    with transaction.atomic():
        plant, _ = Plant.objects.get_or_create(code="GATE_QA_A", defaults={"name": "Gate QA Factory A"})
        other, _ = Plant.objects.get_or_create(code="GATE_QA_B", defaults={"name": "Gate QA Factory B"})
        owner_role, _ = Role.objects.get_or_create(code="OWNER", defaults={"name": "Owner"})
        watchman_role, _ = Role.objects.get_or_create(code="WATCHMAN", defaults={"name": "Watchman", "default_permissions": ["gate.log"]})
        sales_role, _ = Role.objects.get_or_create(code="SALES", defaults={"name": "Sales"})
        for label, role, owner, extra in [("owner", owner_role, True, []), ("watchman", watchman_role, False, []), ("unassigned", watchman_role, False, []), ("delegate", sales_role, False, ["gate.reports"]), ("sales", sales_role, False, [])]:
            password = secrets.token_urlsafe(24)
            account, created = User.objects.get_or_create(username=f"gate_qa_{label}", defaults={"role": role, "is_owner": owner, "extra_permissions": extra})
            if not created:
                raise RuntimeError("Existing fixture account found without private credential file; refusing a password reset.")
            account.set_password(password)
            account.save(update_fields=["password"])
            data[label] = {"username": account.username, "password": password, "id": str(account.id)}
        GateAssignment.objects.get_or_create(user_id=data["watchman"]["id"], plant=plant)
        vendor, _ = Vendor.objects.get_or_create(code="GATE_QA_SUPPLIER", defaults={"name": "QA Packaging Supplier"})
        customer, _ = Customer.objects.get_or_create(code="GATE_QA_CUSTOMER", defaults={"name": "QA Packing Customer"})
        material, _ = InventoryMaterial.objects.get_or_create(code="GATE_QA_HANDLES", defaults={"name": "QA Loop Handles", "category": "ADDON", "base_uom": "PCS", "addon_is_purchased": True, "addon_purchase_uom": "PCS", "weight_mode": "PER_PIECE", "weight_value": 1})
        product, _ = ProductMaster.objects.get_or_create(code="GATE_QA_BAGS", defaults={"name": "QA Packing Bags", "product_kind": "OTHER"})
        po, _ = PurchaseOrder.objects.get_or_create(code="PO-GATE-QA", defaults={"vendor": vendor, "plant": plant, "status": "COMPLETED"})
        item, _ = PurchaseOrderItem.objects.get_or_create(purchase_order=po, line_no=1, defaults={"material": material, "qty_ordered": Decimal("1000"), "qty_received": Decimal("1000"), "uom": "PCS", "rate_per_uom": Decimal("2.36")})
        grn, _ = PurchaseOrderReceipt.objects.get_or_create(code="GRN-GATE-QA", defaults={"purchase_order": po, "plant": plant, "vendor_invoice_no": "GATE-QA-1001", "vendor_invoice_date": timezone.localdate(), "vehicle_no": "DD03U9802", "quality_status": "APPROVED"})
        PurchaseOrderReceiptLine.objects.get_or_create(receipt=grn, po_item=item, defaults={"qty_received": Decimal("1000"), "rate": Decimal("2.36")})
        link, _ = GatePublicLink.objects.get_or_create(plant=plant)
        data.update({"plant": str(plant.id), "other_plant": str(other.id), "public_token": str(link.token), "vendor": str(vendor.id), "customer": str(customer.id), "material": str(material.id), "product": str(product.id), "grn": str(grn.id), "invoice": grn.vendor_invoice_no})
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream)
    print("Synthetic gate acceptance fixtures created in isolated local database; credentials stored privately.")


run()
