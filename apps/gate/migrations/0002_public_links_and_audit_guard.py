import uuid
from django.db import migrations


def configure_links(apps, schema_editor):
    Plant = apps.get_model("factory", "Plant")
    Link = apps.get_model("gate", "GatePublicLink")
    alias = schema_editor.connection.alias
    for plant in Plant.objects.using(alias).all().iterator():
        Link.objects.using(alias).get_or_create(plant_id=plant.id, defaults={"token": uuid.uuid4()})


def guard_audit(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("""
        CREATE OR REPLACE FUNCTION gate_audit_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'Gate audit history is append-only';
        END $$;
        CREATE TRIGGER gate_audit_immutable BEFORE UPDATE OR DELETE ON gate_gateaudit_event
        FOR EACH ROW EXECUTE FUNCTION gate_audit_append_only();
    """.replace("gate_gateaudit_event", apps.get_model("gate", "GateAuditEvent")._meta.db_table))


def unguard_audit(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        table = apps.get_model("gate", "GateAuditEvent")._meta.db_table
        schema_editor.execute(f'DROP TRIGGER IF EXISTS gate_audit_immutable ON "{table}"; DROP FUNCTION IF EXISTS gate_audit_append_only();')


class Migration(migrations.Migration):
    dependencies = [("gate", "0001_initial")]
    operations = [migrations.RunPython(configure_links, migrations.RunPython.noop), migrations.RunPython(guard_audit, unguard_audit)]
