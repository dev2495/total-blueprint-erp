"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { jobWorkApi, type JobWorkLegacyRow } from "@/services/job-work";

import { ErrorBanner, Field, fmtDate, fmtKg, inputClass, isUncertain, jobWorkError, newClientToken, Notice, pickLocation, usePlantLocations } from "./job-work-common";

/**
 * Owner screen: rolls the pre-upgrade job-work screen left "sent to job work"
 * at JOBWORK_OUT. Each action is explicit, audited and retry-safe: mark the
 * rolls used by the job worker (optionally linking the output rolls received
 * back then) or put them back in stock at a chosen location.
 */
export function LegacyReconcile({ plant }: { plant: string }) {
  const legacyQ = useQuery({ queryKey: ["jobwork", "legacy", plant], queryFn: () => jobWorkApi.legacy({ plant }), meta: { suppressGlobalError: true } });
  if (legacyQ.isError) return <ErrorBanner message={jobWorkError(legacyQ.error, "The list could not load.")} onRetry={() => void legacyQ.refetch()} />;
  if (legacyQ.isLoading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  const rows = legacyQ.data?.rows || [];
  return (
    <div className="space-y-4">
      <Notice tone="warn" title="Before-upgrade job work">
        The old job-work screen created new rolls on return but never settled the rolls it sent, so they still show at the job worker. Settle each one here: it is
        recorded in the order timeline with your reason. Nothing is changed until you confirm a group.
      </Notice>
      {rows.length ? (
        rows.map((row) => <LegacyGroup key={row.order?.id || "unattributed"} row={row} />)
      ) : (
        <PanelEmpty icon={<History />} title="Nothing to reconcile">No roll from before the upgrade is still recorded at a job worker.</PanelEmpty>
      )}
    </div>
  );
}

function LegacyGroup({ row }: { row: JobWorkLegacyRow }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [action, setAction] = useState<"CONSUME" | "RETURN">(row.order ? "CONSUME" : "RETURN");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<Parameters<typeof jobWorkApi.reconcileLegacy>[0] | null>(null);
  const plantId = row.order?.plant || row.rolls[0]?.plant || "";
  const locationsQ = usePlantLocations(action === "RETURN" ? plantId : null);
  const effectiveLocation = location || pickLocation(locationsQ.data, "RM")?.id || "";
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const mutation = useMutation({
    mutationFn: jobWorkApi.reconcileLegacy,
    onSuccess: (result) => {
      frozen.current = null;
      setPendingRetry(false);
      setSelected([]);
      setOutputs([]);
      setReason("");
      setFailure(null);
      toast.success(`${result.rolls.length} roll${result.rolls.length === 1 ? "" : "s"} ${result.action === "CONSUME" ? "marked used by the job worker" : "back in stock"}${result.replayed ? " (already saved)" : ""}.`);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      setFailure(jobWorkError(error, "Nothing was reconciled."));
    },
  });

  const submit = () => {
    if (!selected.length) return setFailure("Pick at least one roll.");
    if (reason.trim().length < 5) return setFailure("Write why these rolls are settled (at least 5 characters).");
    if (action === "RETURN" && !effectiveLocation) return setFailure("Choose where the rolls are back in stock.");
    setFailure(null);
    const payload = frozen.current ?? {
      client_token: newClientToken(),
      order_id: row.order?.id ?? null,
      action,
      roll_ids: selected,
      location_id: action === "RETURN" ? effectiveLocation : null,
      output_roll_ids: action === "CONSUME" ? outputs : [],
      reason: reason.trim(),
    };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  return (
    <Panel
      title={
        row.order ? (
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/inventory/job-work/${row.order.id}`} className="font-mono text-primary hover:underline">
              {row.order.number}
            </Link>
            <span className="text-content-3">{row.order.vendor_name}</span>
          </span>
        ) : (
          "Rolls not linked to any order"
        )
      }
      description={
        row.order
          ? `${row.order.plant_name}${row.order.production_job_number ? ` · ${row.order.production_job_number}` : ""} · sent ${fmtDate(row.order.dispatched_at)} · ${row.rolls.length} roll(s), ${fmtKg(row.stuck_kg)} still recorded at the job worker`
          : `${row.rolls.length} roll(s) at JOBWORK_OUT whose order cannot be identified; they can only be put back in stock.`
      }
      bodyClassName="space-y-3"
    >
      {failure ? <ErrorBanner message={failure} /> : null}
      <fieldset>
        <legend className="mb-1 text-[12px] font-semibold text-content-2">Stuck rolls</legend>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {row.rolls.map((roll) => (
            <li key={roll.id}>
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                <input type="checkbox" checked={selected.includes(roll.id)} onChange={() => toggle(selected, setSelected, roll.id)} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono font-semibold">{roll.label_id}</span> · {roll.material_name || "Film"}
                  {roll.width_mm ? ` · ${roll.width_mm} mm` : ""}
                  <span className="block text-[12px] text-content-3">
                    {fmtKg(roll.weight_kg)} · sent {fmtDate(roll.sent_at)} ({roll.age_days} d){roll.production_job_number ? ` · ${roll.production_job_number}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="What happened to them?">
          <select value={action} onChange={(e) => setAction(e.target.value as "CONSUME" | "RETURN")} className={inputClass} disabled={!row.order}>
            {row.order ? <option value="CONSUME">Used by the job worker (output already received)</option> : null}
            <option value="RETURN">Came back unused — put back in stock</option>
          </select>
        </Field>
        {action === "RETURN" ? (
          <Field label="Back in stock at">
            <select value={effectiveLocation} onChange={(e) => setLocation(e.target.value)} className={inputClass}>
              {(locationsQ.data || []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      {action === "CONSUME" && row.output_candidates.length ? (
        <fieldset>
          <legend className="mb-1 text-[12px] font-semibold text-content-2">Link lineage to the output rolls received for this order (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {row.output_candidates.map((out) => (
              <label key={out.id} className={cn("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-[12.5px]", outputs.includes(out.id) ? "border-primary bg-info-bg" : "border-line")}>
                <input type="checkbox" checked={outputs.includes(out.id)} onChange={() => toggle(outputs, setOutputs, out.id)} />
                <span className="font-mono">{out.label_id}</span> · {fmtKg(out.weight_kg)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Field label="Reason (kept in the audit trail)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vendor confirmed both rolls went into the pouches billed on VD/JW/0021" className={inputClass} />
      </Field>
      {pendingRetry ? (
        <p className="text-[12.5px] text-content-3" role="status">
          The last attempt may have reached the server. Confirming again resends the same request, so nothing is settled twice.
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={mutation.isPending || !selected.length} variant={action === "CONSUME" ? "warning" : "default"}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldAlert />}
          {action === "CONSUME" ? `Mark ${selected.length || ""} used` : `Put ${selected.length || ""} back in stock`}
        </Button>
      </div>
    </Panel>
  );
}
