"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { factoryService, type Process } from "@/services/factory";
import { jobWorkApi, OUTPUT_KIND_LABEL, UOM_LABEL, type JobWorkCreatePayload, type JobWorkMode, type JobWorkOutputKind, type JobWorkUom } from "@/services/job-work";
import { cn } from "@/lib/utils";

import { addDaysIso, ErrorBanner, Field, fieldErrors, inputClass, isUncertain, jobWorkError, newClientToken, todayIso } from "./job-work-common";

const ELIGIBLE = new Set(["RELEASED", "EXECUTING", "PAUSED"]);
const UOMS: JobWorkUom[] = ["PCS", "KG", "METER", "ROLL"];

type Form = {
  mode: JobWorkMode;
  production_job: string;
  plant: string;
  process: string;
  vendor: string;
  expected_output_kind: JobWorkOutputKind;
  expected_qty: string;
  expected_uom: JobWorkUom;
  rate: string;
  rate_uom: JobWorkUom;
  wastage_tolerance_pct: string;
  expected_return_date: string;
  emergency_reason: string;
  notes: string;
  save_rate_to_vendor: boolean;
};

const EMPTY: Form = {
  mode: "EMERGENCY",
  production_job: "",
  plant: "",
  process: "",
  vendor: "",
  expected_output_kind: "ROLLS",
  expected_qty: "",
  expected_uom: "KG",
  rate: "",
  rate_uom: "KG",
  wastage_tolerance_pct: "3",
  expected_return_date: addDaysIso(7),
  emergency_reason: "",
  notes: "",
  save_rate_to_vendor: false,
};

/** "New job-work order": expected output, agreed rate (from the vendor rate card) and return date. */
export function CreateOrderDialog({ defaultPlant, triggerClassName }: { defaultPlant?: string; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)} className={triggerClassName} data-testid="jobwork-new-order">
        <Plus /> New job-work order
      </Button>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-24px)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New job-work order</DialogTitle>
          <DialogDescription>
            Material for this order is sent on a printed job-work challan. Returns, the job worker&apos;s bill and closing happen on the order page.
          </DialogDescription>
        </DialogHeader>
        {open ? <CreateOrderForm defaultPlant={defaultPlant} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateOrderForm({ defaultPlant, onDone }: { defaultPlant?: string; onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>({ ...EMPTY, plant: defaultPlant || "" });
  const [jobSearch, setJobSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const frozen = useRef<JobWorkCreatePayload | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const rateTouched = useRef(false);
  // Like the server default: an order for a job is a planned route step unless the user picks otherwise.
  const modeTouched = useRef(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const plantsQ = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const processesQ = useQuery({ queryKey: ["factory-processes"], queryFn: factoryService.getProcesses, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  // Served by the job-work API so inventory accounts without production.view can raise orders.
  const jobsQ = useQuery({
    queryKey: ["jobwork", "eligible-jobs"],
    queryFn: () => jobWorkApi.eligibleJobs(),
    staleTime: 60_000,
    meta: { suppressGlobalError: true },
  });
  const jobs = useMemo(() => {
    const term = jobSearch.trim().toLowerCase();
    return (jobsQ.data || [])
      .filter((job) => ELIGIBLE.has(String(job.job_state)))
      .filter((job) => !term || [job.job_number, job.product_name, job.customer_name, job.order_number, job.process_code].some((v) => String(v || "").toLowerCase().includes(term)))
      .slice(0, 200);
  }, [jobsQ.data, jobSearch]);
  const selectedJob = useMemo(() => (jobsQ.data || []).find((job) => job.id === form.production_job), [jobsQ.data, form.production_job]);
  const process = useMemo(() => ((processesQ.data || []) as Process[]).find((row) => row.id === form.process), [processesQ.data, form.process]);
  const processCode = selectedJob?.process_code || process?.code || "";

  const candidatesQ = useQuery({
    queryKey: ["jobwork", "vendor-candidates", form.production_job, form.plant, processCode],
    queryFn: () => jobWorkApi.vendorCandidates(form.production_job ? { production_job_id: form.production_job } : { plant_id: form.plant, process_code: processCode }),
    enabled: Boolean(form.production_job || form.plant),
    meta: { suppressGlobalError: true },
  });
  const vendors = candidatesQ.data?.results || [];
  const vendor = vendors.find((row) => row.id === form.vendor);
  const cardRate = useMemo(() => {
    const rows = vendor?.process_rates?.length ? vendor.process_rates : (vendor?.jobwork_rates || []).filter((row) => row.process_code === processCode);
    return rows.find((row) => row.uom === form.rate_uom) || rows[0] || null;
  }, [vendor, processCode, form.rate_uom]);

  // Planned route steps need their job; the output defaults from the step (pouching → pieces).
  useEffect(() => {
    if (!selectedJob) return;
    const isPouch = String(selectedJob.process_code || "").toUpperCase().includes("POUCH") || String(selectedJob.uom).toUpperCase() === "PCS";
    setForm((prev) => ({
      ...prev,
      expected_output_kind: isPouch ? "FG_PCS" : "ROLLS",
      expected_uom: isPouch ? "PCS" : "KG",
      rate_uom: rateTouched.current ? prev.rate_uom : isPouch ? "PCS" : "KG",
      expected_qty: prev.expected_qty || String(selectedJob.quantity ?? ""),
    }));
  }, [selectedJob]);
  useEffect(() => {
    if (cardRate && !rateTouched.current) setForm((prev) => ({ ...prev, rate: cardRate.rate, rate_uom: cardRate.uom }));
  }, [cardRate]);

  const mutation = useMutation({
    mutationFn: (payload: JobWorkCreatePayload) => jobWorkApi.create(payload),
    onSuccess: (result) => {
      frozen.current = null;
      setPendingRetry(false);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      toast.success(`${result.order.number} created${result.replayed ? " (already saved)" : ""}.`);
      onDone();
      router.push(`/inventory/job-work/${result.order.id}`);
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      setErrors(fieldErrors(error));
      setFailure(jobWorkError(error, "The order was not created."));
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (form.mode === "PLANNED_STEP" && !form.production_job) local.production_job = "Pick the production job whose route step goes to job work.";
    if (!form.production_job && !form.plant) local.plant = "Choose the plant that sends the material.";
    if (!form.vendor) local.vendor = "Choose the job worker.";
    if (form.mode === "EMERGENCY" && !form.emergency_reason.trim()) local.emergency_reason = "Say why this work goes out in an emergency.";
    if (form.expected_output_kind === "FG_PCS" && !form.production_job) local.expected_output_kind = "Finished pieces are booked against a production job.";
    if (form.expected_return_date && form.expected_return_date < todayIso()) local.expected_return_date = "Choose today or a later date.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setFailure(null);
    const payload: JobWorkCreatePayload = frozen.current ?? {
      client_token: newClientToken(),
      mode: form.mode,
      vendor: form.vendor,
      production_job: form.production_job || null,
      plant: form.production_job ? null : form.plant,
      process: form.process || null,
      emergency_reason: form.mode === "EMERGENCY" ? form.emergency_reason.trim() : "",
      notes: form.notes.trim(),
      expected_output_kind: form.expected_output_kind,
      expected_qty: form.expected_qty || null,
      expected_uom: form.expected_qty ? form.expected_uom : "",
      rate: form.rate || null,
      rate_uom: form.rate ? form.rate_uom : "",
      wastage_tolerance_pct: form.wastage_tolerance_pct || null,
      expected_return_date: form.expected_return_date || null,
      save_rate_to_vendor: Boolean(form.rate && form.save_rate_to_vendor),
    };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  const plants = plantsQ.data || [];
  const busy = mutation.isPending;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {failure ? <ErrorBanner message={failure} /> : null}
      {pendingRetry ? (
        <p className="text-[12.5px] text-content-3" role="status">
          The last attempt may have reached the server. Retrying sends the same order again, so it cannot be created twice.{" "}
          <button
            type="button"
            className="font-semibold text-primary underline-offset-2 hover:underline"
            onClick={() => {
              frozen.current = null;
              setPendingRetry(false);
              setFailure(null);
            }}
          >
            Start over with my edits
          </button>
        </p>
      ) : null}
      <fieldset className="grid grid-cols-2 gap-2" aria-label="How the work goes out">
        {(["PLANNED_STEP", "EMERGENCY"] as JobWorkMode[]).map((mode) => (
          <label
            key={mode}
            className={cn(
              "flex min-h-[56px] cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 text-[13px] focus-within:ring-2 focus-within:ring-info-border",
              form.mode === mode ? "border-primary bg-info-bg" : "border-line bg-surface-1",
            )}
          >
            <span className="flex items-center gap-2 font-semibold text-content-1">
              <input
                type="radio"
                name="jw-mode"
                checked={form.mode === mode}
                onChange={() => {
                  modeTouched.current = true;
                  set("mode", mode);
                }}
              />
              {mode === "PLANNED_STEP" ? "Planned route step" : "Emergency handoff"}
            </span>
            <span className="text-[12px] text-content-3">
              {mode === "PLANNED_STEP" ? "The route sends this step out; closing completes the step." : "In-house capacity is short; closing releases the job."}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={form.mode === "PLANNED_STEP" ? "Production job" : "Production job (optional)"} error={errors.production_job} htmlFor="jw-job">
          <input
            aria-label="Search jobs"
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
            placeholder="Search job, product, customer"
            className={cn(inputClass, "mb-1.5")}
          />
          <select
            id="jw-job"
            value={form.production_job}
            onChange={(e) => {
              const jobId = e.target.value;
              setForm((prev) => ({ ...prev, production_job: jobId, mode: modeTouched.current ? prev.mode : jobId ? "PLANNED_STEP" : "EMERGENCY" }));
            }}
            className={inputClass}
          >
            <option value="">{jobsQ.isLoading ? "Loading jobs…" : "No job"}</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.job_number} · {job.process_code} · {job.product_name || job.template_name} · {job.job_state.toLowerCase()}
              </option>
            ))}
          </select>
          {jobsQ.isError ? <p className="mt-1 text-[12px] text-danger-fg">Jobs could not load. Close and reopen to retry.</p> : null}
        </Field>
        {form.production_job ? (
          <Field label="Plant" hint={selectedJob?.work_center_name ? `Taken from the job's work centre (${selectedJob.work_center_name}).` : "Taken from the job's work centre."}>
            <input value={selectedJob?.plant_name || "From the job"} readOnly aria-label="Plant" className={inputClass} />
          </Field>
        ) : (
          <Field label="Plant" error={errors.plant} htmlFor="jw-plant">
            <select id="jw-plant" value={form.plant} onChange={(e) => set("plant", e.target.value)} className={inputClass}>
              <option value="">Choose plant</option>
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!form.production_job ? (
          <Field label="Process at the job worker" hint="Used for the challan purpose and the vendor rate card." htmlFor="jw-process">
            <select id="jw-process" value={form.process} onChange={(e) => set("process", e.target.value)} className={inputClass}>
              <option value="">Not specified</option>
              {((processesQ.data || []) as Process[]).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.code})
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Job worker" error={errors.vendor} htmlFor="jw-vendor" hint={vendor && !vendor.vendor_capability_match ? vendor.match_reasons.join(" ") : undefined}>
          <select id="jw-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} className={inputClass} disabled={!form.production_job && !form.plant}>
            <option value="">{candidatesQ.isLoading ? "Loading job workers…" : !form.production_job && !form.plant ? "Pick the job or plant first" : "Choose job worker"}</option>
            {vendors.map((row) => (
              <option key={row.id} value={row.id} disabled={!row.vendor_capability_match}>
                {row.name} ({row.code}){row.state ? ` · ${row.state}` : ""}{row.vendor_capability_match ? "" : " · not mapped"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {form.mode === "EMERGENCY" ? (
        <Field label="Why is it going out?" error={errors.emergency_reason} htmlFor="jw-reason">
          <input id="jw-reason" value={form.emergency_reason} onChange={(e) => set("emergency_reason", e.target.value)} placeholder="Laminator breakdown, urgent dispatch, capacity…" className={inputClass} />
        </Field>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Expected output" error={errors.expected_output_kind} htmlFor="jw-output">
          <select id="jw-output" value={form.expected_output_kind} onChange={(e) => set("expected_output_kind", e.target.value as JobWorkOutputKind)} className={inputClass}>
            {(Object.keys(OUTPUT_KIND_LABEL) as JobWorkOutputKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {OUTPUT_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected quantity" error={errors.expected_qty} htmlFor="jw-qty">
          <div className="flex gap-2">
            <input id="jw-qty" inputMode="decimal" value={form.expected_qty} onChange={(e) => set("expected_qty", e.target.value)} placeholder="e.g. 24000" className={inputClass} />
            <select aria-label="Expected quantity unit" value={form.expected_uom} onChange={(e) => set("expected_uom", e.target.value as JobWorkUom)} className={cn(inputClass, "w-28")}>
              {UOMS.map((uom) => (
                <option key={uom} value={uom}>
                  {uom}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Expected back by" error={errors.expected_return_date} htmlFor="jw-date" hint="Overdue alerts start after this date.">
          <input id="jw-date" type="date" min={todayIso()} value={form.expected_return_date} onChange={(e) => set("expected_return_date", e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field
          label="Agreed labour rate (₹, before GST)"
          error={errors.rate}
          htmlFor="jw-rate"
          hint={cardRate ? `Rate card: ₹${cardRate.rate} per ${UOM_LABEL[cardRate.uom]}` : vendor ? "No rate card entry for this process yet." : undefined}
        >
          <div className="flex gap-2">
            <input
              id="jw-rate"
              inputMode="decimal"
              value={form.rate}
              onChange={(e) => {
                rateTouched.current = true;
                set("rate", e.target.value);
              }}
              placeholder="2.50"
              className={inputClass}
            />
            <select
              aria-label="Rate per"
              value={form.rate_uom}
              onChange={(e) => {
                rateTouched.current = true;
                set("rate_uom", e.target.value as JobWorkUom);
              }}
              className={cn(inputClass, "w-28")}
            >
              {UOMS.map((uom) => (
                <option key={uom} value={uom}>
                  per {UOM_LABEL[uom]}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Balance tolerance %" error={errors.wastage_tolerance_pct} htmlFor="jw-tol" hint="Unexplained difference allowed between material sent and material accounted for.">
          <input id="jw-tol" inputMode="decimal" value={form.wastage_tolerance_pct} onChange={(e) => set("wastage_tolerance_pct", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Notes" htmlFor="jw-notes">
          <input id="jw-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      {form.rate && vendor && (!cardRate || cardRate.rate !== form.rate || cardRate.uom !== form.rate_uom) && (processCode || form.process) ? (
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-content-2">
          <input type="checkbox" checked={form.save_rate_to_vendor} onChange={(e) => set("save_rate_to_vendor", e.target.checked)} />
          Save ₹{form.rate} per {UOM_LABEL[form.rate_uom]} to {vendor.name}&apos;s rate card for {processCode || process?.code}
        </label>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} data-testid="jobwork-create-submit">
          {busy ? <Loader2 className="animate-spin" /> : null}
          {pendingRetry ? "Retry create" : "Create order"}
        </Button>
      </div>
    </form>
  );
}
