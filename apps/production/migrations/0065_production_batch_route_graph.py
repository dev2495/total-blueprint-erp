import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0064_machine_operator_hot_path_index"),
        ("routing", "0003_routingrule_route_graph"),
        ("sales", "0035_sales_hot_path_indexes"),
        ("templates", "0034_templateblueprint_batch_execution_policy"),
    ]
    operations = [
        migrations.CreateModel(
            name="ProductionBatch",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("batch_number", models.CharField(max_length=80, unique=True)),
                ("batch_sequence", models.PositiveIntegerField(default=1)),
                ("planned_qty", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("planned_uom", models.CharField(default="KG", max_length=10)),
                ("produced_qty_kg", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("produced_qty_pcs", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("packed_qty_kg", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("packed_qty_pcs", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("dispatched_qty_kg", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("dispatched_qty_pcs", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("current_step_index", models.IntegerField(default=0)),
                ("current_route_node_id", models.CharField(blank=True, default="", max_length=80)),
                ("current_route_branch_key", models.CharField(blank=True, default="", max_length=80)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PLANNED", "Planned"),
                            ("RELEASED", "Released"),
                            ("RUNNING", "Running"),
                            ("WAITING_JOIN", "Waiting For Join"),
                            ("PACKING_READY", "Packing Ready"),
                            ("DISPATCH_READY", "Dispatch Ready"),
                            ("DISPATCHED", "Dispatched"),
                            ("COMPLETED", "Completed"),
                            ("HOLD", "On Hold"),
                            ("CANCELLED", "Cancelled"),
                        ],
                        db_index=True,
                        default="PLANNED",
                        max_length=24,
                    ),
                ),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("AUTO_SPLIT", "Auto split from template policy"),
                            ("MANUAL_SPLIT", "Manual WCM split"),
                            ("MACHINE_OUTPUT", "Created from machine output"),
                            ("REPLAN", "Planner replan"),
                            ("LEGACY_SINGLE", "Legacy single-batch fallback"),
                        ],
                        default="LEGACY_SINGLE",
                        max_length=24,
                    ),
                ),
                ("allow_partial_movement", models.BooleanField(default=True)),
                ("required_input_refs", models.JSONField(blank=True, default=list)),
                ("matched_input_refs", models.JSONField(blank=True, default=list)),
                ("route_snapshot", models.JSONField(blank=True, default=dict)),
                ("policy_snapshot", models.JSONField(blank=True, default=dict)),
                ("meta_json", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "parent_batch",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="child_batches",
                        to="production.productionbatch",
                    ),
                ),
                (
                    "routing_rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="production_batches",
                        to="routing.routingrule",
                    ),
                ),
                (
                    "sales_order_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="production_batches",
                        to="sales.salesorderitem",
                    ),
                ),
                (
                    "template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="production_batches",
                        to="templates.templateblueprint",
                    ),
                ),
            ],
            options={
                "db_table": "production_batches",
                "ordering": ["sales_order_item_id", "batch_sequence", "created_at"],
            },
        ),
        migrations.AddField(
            model_name="productionjob",
            name="production_batch",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                help_text="Live production batch/lot under the commercial sales-order line.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="jobs",
                to="production.productionbatch",
            ),
        ),
        migrations.AddField(
            model_name="productionjob",
            name="route_branch_key",
            field=models.CharField(blank=True, db_index=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="productionjob",
            name="route_node_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="productionjob",
            name="route_predecessor_node_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="productionjob",
            name="route_successor_node_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="finishedgoodsbatch",
            name="production_batch",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="fg_batches",
                to="production.productionbatch",
            ),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="production_batch",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="packing_units",
                to="production.productionbatch",
            ),
        ),
        migrations.AddIndex(
            model_name="productionbatch",
            index=models.Index(fields=["sales_order_item", "status"], name="prod_batch_soi_status"),
        ),
        migrations.AddIndex(
            model_name="productionbatch",
            index=models.Index(fields=["status", "-updated_at"], name="prod_batch_status_updated"),
        ),
        migrations.AddIndex(
            model_name="productionbatch",
            index=models.Index(fields=["current_route_node_id", "status"], name="prod_batch_node_status"),
        ),
        migrations.AddConstraint(
            model_name="productionbatch",
            constraint=models.UniqueConstraint(fields=("sales_order_item", "batch_sequence"), name="uniq_prod_batch_line_seq"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["production_batch", "job_state"], name="prod_job_batch_state"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["route_node_id", "job_state"], name="prod_job_node_state"),
        ),
    ]
