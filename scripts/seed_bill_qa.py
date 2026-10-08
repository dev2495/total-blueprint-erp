"""Seed synthetic bill-flow QA only in the named isolated local database."""
import json, os, secrets
from decimal import Decimal
from pathlib import Path
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from apps.factory.models import Plant
from apps.gate.models import GateAssignment, GatePublicLink
from apps.inventory.models import InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial, ProductMaster
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderReceipt, PurchaseOrderReceiptLine
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.sales.models import Customer
from apps.users.models import Role, User


def run():
    if settings.DATABASES['default']['NAME'] != 'tpp_bill_dev_20261008':
        raise RuntimeError('Bill fixtures require the isolated named local QA database.')
    output = Path(settings.BASE_DIR)/'.runtime'/'bill-qa.json'
    if output.exists():
        print('Synthetic bill fixtures already exist; private credentials preserved.')
        return
    data={}
    with transaction.atomic():
        plant=Plant.objects.create(code='BILL_QA_A',name='Bill QA Factory A')
        other=Plant.objects.create(code='BILL_QA_B',name='Bill QA Factory B')
        specs=[('admin','ADMIN',False,[]),('owner','OWNER',True,[]),('watchman','WATCHMAN',False,[]),('unassigned','WATCHMAN',False,[]),('store','STORE',False,[]),('delegate','SALES',False,['gate.reports']),('sales','SALES',False,[]),('dispatch','DISPATCH',False,[]),('custom_review','SALES',False,['gate.bill.review','inventory.manage'])]
        for label,code,is_owner,extra in specs:
            role,_=Role.objects.get_or_create(code=code,defaults={'name':code.title()})
            password=secrets.token_urlsafe(24)
            account=User.objects.create(username=f'bill_qa_{label}',role=role,is_owner=is_owner,extra_permissions=extra)
            account.set_password(password)
            account.save(update_fields=['password'])
            data[label]={'username':account.username,'password':password,'id':str(account.id)}
        GateAssignment.objects.create(user_id=data['watchman']['id'],plant=plant)
        vendor=Vendor.objects.create(code='BILL_QA_VENDOR',name='QA Packaging and Polymer Supplier - long master label for phone layout testing')
        customer=Customer.objects.create(code='BILL_QA_CUSTOMER',name='QA Packing Customer')
        material=InventoryMaterial.objects.create(code='BILL_QA_HANDLES',name='QA Loop Handles - extended purchased add-on master label',category='ADDON',base_uom='PCS',addon_is_purchased=True,addon_purchase_uom='PCS',weight_mode='PER_PIECE',weight_value=1)
        bulk=InventoryMaterial.objects.create(code='BILL_QA_LDPE',name='QA LDPE Granules for Synthetic Receiving',category='GRANULE',base_uom='KG')
        film=InventoryMaterial.objects.create(code='BILL_QA_FILM',name='QA Film Roll for Synthetic Receiving',category='FILM',base_uom='KG')
        product=ProductMaster.objects.create(code='BILL_QA_BAGS',name='QA Packing Bags',product_kind='OTHER')
        location=InventoryLocation.objects.create(plant=plant,code='BILL_QA_STORE',name='QA Receiving Warehouse',type='WAREHOUSE')
        other_location=InventoryLocation.objects.create(plant=other,code='BILL_QA_STORE',name='QA Other Warehouse',type='WAREHOUSE')
        po=PurchaseOrder.objects.create(code='PO-BILL-QA',vendor=vendor,plant=plant,status='SENT')
        item=PurchaseOrderItem.objects.create(purchase_order=po,line_no=1,material=material,qty_ordered=Decimal('1000'),uom='PCS',rate_per_uom=Decimal('2.36'))
        grn=PurchaseOrderReceiptService.create(po=po,user=User.objects.get(id=data['store']['id']),location=location,lines_data=[{'po_item_id':str(item.id),'qty_received':'1000','rate':'2.36'}],vendor_invoice_no='BILL-QA-MATCH-1001',vendor_invoice_date=timezone.localdate(),vehicle_no='DD03U9802',quality_status='APPROVED')
        open_po=PurchaseOrder.objects.create(code='PO-BILL-QA-OPEN',vendor=vendor,plant=plant,status='SENT')
        open_line=PurchaseOrderItem.objects.create(purchase_order=open_po,line_no=1,material=bulk,qty_ordered=Decimal('500'),uom='KG',rate_per_uom=Decimal('100'))
        link,_=GatePublicLink.objects.get_or_create(plant=plant)
        data.update(plant=str(plant.id),other_plant=str(other.id),vendor=str(vendor.id),customer=str(customer.id),material=str(material.id),bulk_material=str(bulk.id),film_material=str(film.id),product=str(product.id),location=str(location.id),other_location=str(other_location.id),grn=str(grn.id),invoice=grn.vendor_invoice_no,open_po=str(open_po.id),open_po_item=str(open_line.id),public_token=str(link.token))
    output.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:json.dump(data,stream)
    print('Synthetic bill QA seeded locally; credentials saved privately, never printed.')

run()
