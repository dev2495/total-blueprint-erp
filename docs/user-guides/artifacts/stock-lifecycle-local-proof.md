# Stock Lifecycle Local Proof

Command:

```bash
'/Users/devarshthakkar/local_repos/erp total/venv/bin/python' scripts/prove_stock_lifecycle_local_flow.py
```

Result:

```text
INFO apps.inventory.services.inventory_audit_service Created inventory snapshot for SLP02155332: f3732cb7-e6c5-40c9-a31d-ae91cdce87ca
PASS plant=SLP02155332 fy=3126-3127
PASS opening_batch=OPEN-3126-3127-FBEDC7F2 posted
PASS granule_code_partial_count batch=COUNT-3126-3127-CE98333E A=95kg B=40kg untouched
PASS roll_form_count batch=COUNT-3126-3127-EB71B022 label=ROLL-20260602-A7E99D36 form=LAYFLAT_TUBE
PASS packing_eod_count batch=COUNT-3126-3127-FCF47249 packaging=190pcs transaction=COUNT_SHORT
PASS month_snapshot bulk=135.0000kg roll=25.000kg
PASS stock_card opening=140.0 movement=-5.0 closing=135.0
PASS fy_close closing_batch=FYC-3126-3127-FC0D9A34 next_opening=OPEN-3127-3128-4171B220
PASS rollback_safe=True temporary proof data removed after transaction
```
