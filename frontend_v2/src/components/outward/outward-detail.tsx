"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ChevronDown, Clock3, Link2, Loader2, QrCode, Search, ShieldAlert, Unlink } from "lucide-react";
import { toast } from "sonner";

import { BillWorkspace } from "@/components/documents/bill-workspace";
import { useGateOperation } from "@/components/gate/use-gate-operation";
import { Panel } from "@/components/premium";
import { Button } from "@/components/ui/button";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  OUTWARD_KIND_LABEL,
  looksLikeErpCode,
  outwardApi,
  type OtherDeparture,
  type OutwardCandidate,
  type OutwardDocument,
  type OutwardLink,
  type OutwardLinkKind,
  type QrChip,
} from "@/services/outward";

import { ActionFeedback, LoadFailure, RightsDenied, docDate, docDateTime, useDebounced, useDocumentRights } from "./document-rights";
import { OutwardStatusPill, outwardWorkspaceDocument } from "./outward-common";
import { ReasonDialog } from "./reason-dialog";

const ACTION_LABEL: Record<string, string> = {
  OUTWARD_RECORDED: "Photographed at the gate",
  OUTWARD_LINKED: "ERP document linked",
  OUTWARD_UNLINKED: "Link removed",
  OUTWARD_MATCHED: "Marked matched",
  OUTWARD_DISCREPANCY: "Discrepancy noted",
  OUTWARD_VOIDED: "Voided",
};

export function OutwardDetail({ id }: { id: string }) {
  const rights = useDocumentRights();
  const allowed = rights.has("outward.reconcile");
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["inventory", "outward", "detail", id], [id]);
  const detailQ = useQuery({
    queryKey,
    queryFn: () => outwardApi.get(id),
    enabled: allowed && Boolean(id),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, error) => ![403, 404].includes(getApiErrorStatus(error) ?? 0) && count < 2,
    meta: { suppressGlobalError: true },
  });
  const doc = detailQ.data ?? null;
  const workspaceDoc = useMemo(() => (doc ? outwardWorkspaceDocument(doc) : null), [doc]);

  const apply = useCallback(
    (next: OutwardDocument) => {
      qc.setQueryData(queryKey, next);
      void qc.invalidateQueries({ queryKey: ["inventory", "outward", "list"] });
      void qc.invalidateQueries({ queryKey: ["inventory", "outward", "candidates", id] });
    },
    [qc, queryKey, id],
  );

  if (rights.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!allowed) {
    return <RightsDenied title="Outward documents are for the inventory team" body="Matching outward gate photos needs the “Match outward gate photos” right. Ask an administrator if you need it." />;
  }
  if (!id) return <RightsDenied title="This link is not valid" body="Open the record again from the outward documents queue." href="/inventory/outward-documents" linkLabel="Outward documents" />;
  if (detailQ.isError && !doc) {
    const status = getApiErrorStatus(detailQ.error);
    if (status === 404) return <RightsDenied title="This outward record is not available" body="It may have been opened from an old link. Find it again in the queue." href="/inventory/outward-documents" linkLabel="Outward documents" />;
    return (
      <div className="mx-auto max-w-[900px] space-y-3 p-2">
        <BackLink />
        <LoadFailure subject="This outward record" error={detailQ.error} retry={() => void detailQ.refetch()} />
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="mx-auto max-w-[900px] space-y-3 p-2" role="status" aria-label="Loading outward record">
        <div className="h-10 w-48 animate-pulse rounded-xl bg-surface-2" />
        <div className="h-[220px] animate-pulse rounded-3xl bg-surface-2" />
        <div className="h-[320px] animate-pulse rounded-3xl bg-surface-2" />
      </div>
    );
  }

  return (
    <BillWorkspace document={workspaceDoc}>
      <div className="space-y-4 pb-10" data-testid="outward-detail">
        <Header doc={doc} />
        {detailQ.isError ? <LoadFailure subject="The latest details" error={detailQ.error} retry={() => void detailQ.refetch()} /> : null}
        <StatusBanner doc={doc} />
        <LinkedPanel doc={doc} onChange={apply} />
        {doc.status !== "VOID" ? <FindPanel doc={doc} onChange={apply} /> : null}
        <ScannedPanel doc={doc} />
        {doc.status !== "VOID" ? <FinishPanel doc={doc} onChange={apply} canVoid={Boolean(doc.can_void)} /> : null}
        <HistoryPanel doc={doc} />
      </div>
    </BillWorkspace>
  );
}

function BackLink() {
  return (
    <Link href="/inventory/outward-documents" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-content-2 hover:text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
      <ArrowLeft className="h-4 w-4" /> Outward documents
    </Link>
  );
}

function Header({ doc }: { doc: OutwardDocument }) {
  return (
    <div className="space-y-2">
      <BackLink />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-content-1">
          Outward <span className="font-mono">{doc.reference}</span>
        </h1>
        <OutwardStatusPill status={doc.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
        <Fact label="Left the gate" value={docDateTime(doc.departed_at)} />
        <Fact label="Factory" value={doc.plant_name} />
        <Fact label="Vehicle" value={doc.vehicle_number ? <span className="font-mono font-semibold">{doc.vehicle_number}</span> : "Not noted"} />
        <Fact label="Recorded by" value={doc.created_by_name} />
      </dl>
      {doc.duplicate_photos?.length ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The same photos were recorded again:{" "}
            {doc.duplicate_photos.map((row, index) => (
              <span key={row.document_id}>
                {index ? ", " : ""}
                <Link className="font-semibold underline" href={`/inventory/outward-documents/${row.document_id}`}>
                  {docDateTime(row.departed_at)}
                </Link>
              </span>
            ))}
            . Void the repeat if it is the same truck.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">{label}</dt>
      <dd className="truncate text-content-1">{value}</dd>
    </div>
  );
}

function StatusBanner({ doc }: { doc: OutwardDocument }) {
  if (doc.status === "VOID") {
    return (
      <div role="status" className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-content-2">
        <div className="font-semibold text-content-1">Voided {doc.voided_at ? docDateTime(doc.voided_at) : ""}{doc.voided_by_name ? ` by ${doc.voided_by_name}` : ""}</div>
        <p className="mt-0.5">{doc.resolution_reason}</p>
        <p className="mt-1 text-content-3">The photos and the departure time stay on record. Links were removed and a gate pass that left only on this record was reopened.</p>
      </div>
    );
  }
  if (doc.status === "MATCHED") {
    return (
      <div role="status" className="flex items-start gap-2 rounded-2xl border border-success-border bg-success-bg px-4 py-3 text-[13px] text-success-fg">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Matched {doc.matched_at ? docDateTime(doc.matched_at) : ""}
          {doc.matched_by_name ? ` by ${doc.matched_by_name}` : ""}. {doc.resolution_reason}
        </span>
      </div>
    );
  }
  if (doc.status === "DISCREPANCY") {
    return (
      <div role="status" className="rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" /> Discrepancy to follow up
        </div>
        <ul className="mt-1 space-y-1">
          {(doc.discrepancies ?? []).map((row, index) => (
            <li key={index}>
              {row.notes} <span className="opacity-80">— {row.by}, {docDateTime(row.at)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-start gap-2 rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-fg">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Look at the photos, link the ERP documents that left on this truck, then mark the departure matched. Matching never moves stock or marks delivery.</span>
    </div>
  );
}

function DepartureWarning({ rows }: { rows?: OtherDeparture[] }) {
  if (!rows?.length) return null;
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-warning-fg">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Also left on{" "}
        {rows.map((row, index) => (
          <span key={row.document_id}>
            {index ? ", " : ""}
            <Link className="font-semibold underline" href={`/inventory/outward-documents/${row.document_id}`}>
              {docDateTime(row.departed_at)}
              {row.vehicle_number ? ` (${row.vehicle_number})` : ""}
            </Link>
          </span>
        ))}
        . Normal for a challan sent over several trips — check it is not a repeat.
      </span>
    </p>
  );
}

function SnapshotLines({ link }: { link: Pick<OutwardLink, "snapshot"> }) {
  const [open, setOpen] = useState(false);
  const lines = link.snapshot?.lines ?? [];
  if (!lines.length) return null;
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg text-[12.5px] font-semibold text-content-2 hover:text-content-1">
        <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")} /> {open ? "Hide" : "Show"} {link.snapshot?.line_count ?? lines.length} line{lines.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <table className="mt-1 w-full text-[12.5px]">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-1 pr-2 text-content-2">{line.description}</td>
                <td className="whitespace-nowrap py-1 text-right font-mono tabular-nums text-content-1">
                  {line.quantity ?? "—"} {line.uom}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function LinkedPanel({ doc, onChange }: { doc: OutwardDocument; onChange: (next: OutwardDocument) => void }) {
  const [removing, setRemoving] = useState<OutwardLink | null>(null);
  return (
    <Panel title="Documents on this departure" description="What the office confirmed left on this truck. One truck may carry several documents.">
      {doc.links.length ? (
        <ul className="space-y-2">
          {doc.links.map((link) => (
            <li key={link.id} className="rounded-xl border border-line bg-surface-1 px-3 py-2.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[14px] font-semibold text-content-1">{link.reference || "—"}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-content-2">{link.kind_label}</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-content-3">
                      {link.link_source === "QR" ? <QrCode className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      {link.link_source === "QR" ? "QR at the gate" : `Linked by ${link.linked_by_name}`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-content-2">
                    {[link.party_name, link.summary, link.snapshot?.document_date ? docDate(link.snapshot.document_date) : null].filter(Boolean).join(" · ")}
                  </div>
                  {link.snapshot?.warnings?.map((warning) => (
                    <p key={warning} className="mt-1 text-[12.5px] font-semibold text-warning-fg">
                      {warning}
                    </p>
                  ))}
                  <DepartureWarning rows={link.other_departures} />
                  <SnapshotLines link={link} />
                </div>
                {doc.status !== "VOID" ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(link)} aria-label={`Remove link ${link.reference}`}>
                    <Unlink className="h-4 w-4" /> Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line bg-surface-2/60 px-4 py-6 text-center text-[13px] text-content-3">
          No ERP document linked yet. Search below, or paste the code printed on the paper.
        </p>
      )}
      {doc.removed_links?.length ? (
        <details className="mt-3 text-[12.5px] text-content-3">
          <summary className="cursor-pointer font-semibold text-content-2">Removed links ({doc.removed_links.length})</summary>
          <ul className="mt-1 space-y-1">
            {doc.removed_links.map((link) => (
              <li key={link.id}>
                <span className="font-mono line-through">{link.reference}</span> · removed {docDateTime(link.removed_at)} by {link.removed_by_name}: {link.removed_reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ReasonDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.reference || "this link"}?`}
        description="The link stays in the history with your reason. A gate pass that left only on this record goes back to ‘issued’."
        confirmLabel="Remove link"
        destructive
        placeholder="e.g. Wrong challan picked — this truck carried DC-2627-0413"
        onSubmit={(payload) => outwardApi.unlink(doc.id, { ...payload, link_id: removing?.id ?? "" })}
        onDone={(next) => {
          onChange(next);
          toast.success("Link removed.");
        }}
      />
    </Panel>
  );
}

type LinkPayload = { kind: OutwardLinkKind; object_id?: string; reference?: string; party_name?: string; reason?: string };

function useLinkAction(doc: OutwardDocument, onChange: (next: OutwardDocument) => void) {
  return useGateOperation<LinkPayload, OutwardDocument>({
    send: (payload) => outwardApi.link(doc.id, payload),
    onSaved: (next) => {
      onChange(next);
      if (next.link_warnings?.length) {
        toast.warning(`Linked. The same document also left on ${next.link_warnings.map((row) => docDateTime(row.departed_at)).join(", ")}.`);
      } else {
        toast.success("Linked to this departure.");
      }
    },
  });
}

function FindPanel({ doc, onChange }: { doc: OutwardDocument; onChange: (next: OutwardDocument) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OutwardLinkKind | "">("");
  const q = useDebounced(query.trim());
  const linkOp = useLinkAction(doc, onChange);
  const [pending, setPending] = useState<string | null>(null);
  const candidatesQ = useQuery({
    queryKey: ["inventory", "outward", "candidates", doc.id, q, kind],
    queryFn: () => outwardApi.candidates(doc.id, { q: q || undefined, kind: kind || undefined }),
    staleTime: 10_000,
    meta: { suppressGlobalError: true },
  });
  const kinds = candidatesQ.data?.kinds ?? [];
  const rows = candidatesQ.data?.results ?? [];

  const link = (row: OutwardCandidate) => {
    if (!row.id || linkOp.locked) return;
    setPending(`${row.kind}:${row.id}`);
    void linkOp.submit({ kind: row.kind, object_id: row.id }).finally(() => setPending(null));
  };

  return (
    <Panel title="Find the ERP document" description={q ? "Search results at this factory." : "Documents dated near this departure at this factory. Search by DC / invoice / gate pass number, party or vehicle."}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="relative block">
          <span className="sr-only">Search ERP documents</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="DC-2627-0412, party name, vehicle…" className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border" />
        </label>
        <label className="block">
          <span className="sr-only">Document type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as OutwardLinkKind | "")} className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary">
            <option value="">All document types</option>
            {kinds.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ActionFeedback className="mt-2" phase={linkOp.phase} error={linkOp.error} onRetry={() => void linkOp.retry()} onRelease={linkOp.release} />
      <div className="mt-3">
        {candidatesQ.isError ? (
          <LoadFailure subject="Matching documents" error={candidatesQ.error} retry={() => void candidatesQ.refetch()} />
        ) : candidatesQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[64px] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {rows.map((row) => {
              const key = `${row.kind}:${row.id}`;
              return (
                <li key={key} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13.5px] font-semibold text-content-1">{row.reference}</span>
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-content-2">{row.kind_label}</span>
                      {row.status ? <span className="text-[11.5px] text-content-3">{row.status.replace(/_/g, " ").toLowerCase()}</span> : null}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-content-2">{[row.party_name, row.summary, row.document_date ? docDate(row.document_date) : null].filter(Boolean).join(" · ")}</div>
                    {row.warnings?.map((warning) => (
                      <p key={warning} className="mt-0.5 text-[12px] text-warning-fg">
                        {warning}
                      </p>
                    ))}
                    <DepartureWarning rows={row.other_departures} />
                  </div>
                  <Button type="button" size="sm" variant={row.linked_here ? "secondary" : "default"} disabled={row.linked_here || linkOp.locked} onClick={() => link(row)}>
                    {pending === key ? <Loader2 className="h-4 w-4 animate-spin" /> : row.linked_here ? <CheckCircle2 className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    {row.linked_here ? "Linked" : "Link"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line bg-surface-2/60 px-4 py-6 text-center text-[13px] text-content-3">
            {q ? "Nothing at this factory matches that search." : "No ERP documents dated near this departure. Search by number or party."}
          </p>
        )}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CodeLinkBox doc={doc} onChange={onChange} />
        <OtherPaperBox doc={doc} onChange={onChange} />
      </div>
    </Panel>
  );
}

function CodeLinkBox({ doc, onChange }: { doc: OutwardDocument; onChange: (next: OutwardDocument) => void }) {
  const [code, setCode] = useState("");
  const [chip, setChip] = useState<QrChip | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkOp = useLinkAction(doc, (next) => {
    onChange(next);
    setCode("");
    setChip(null);
  });

  const check = async () => {
    const value = code.trim();
    setChip(null);
    setError(null);
    if (!looksLikeErpCode(value)) {
      setError("That is not an ERP document code. It looks like TPP1.SALES_DC.…");
      return;
    }
    setChecking(true);
    try {
      setChip(await outwardApi.resolveCode(value, doc.plant));
    } catch (caught) {
      setError((caught as Error)?.message || "This code could not be checked.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <form
      className="rounded-xl border border-line bg-surface-2/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void check();
      }}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-content-1">
        <QrCode className="h-4 w-4" /> Link by QR code
      </div>
      <p className="mt-0.5 text-[12px] text-content-3">Scan the QR on the paper with a desk scanner, or paste its text.</p>
      <div className="mt-2 flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">QR code text</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TPP1.…" className="h-10 w-full rounded-lg border border-line bg-surface-1 px-3 font-mono text-[12.5px] text-content-1 outline-none focus:border-primary" />
        </label>
        <Button type="submit" variant="outline" disabled={!code.trim() || checking}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
      {chip ? (
        <div className="mt-2 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-[12.5px] text-success-fg">
          <div className="font-semibold">
            Recognised: <span className="font-mono">{chip.reference}</span> · {chip.summary}
          </div>
          <div>
            {chip.kind_label}
            {chip.party_name ? ` · ${chip.party_name}` : ""}
          </div>
          {chip.warnings.map((warning) => (
            <div key={warning} className="font-semibold text-warning-fg">
              {warning}
            </div>
          ))}
          <Button type="button" size="sm" className="mt-2" disabled={linkOp.locked} onClick={() => void linkOp.submit({ kind: chip.kind, object_id: chip.id })}>
            <Link2 className="h-4 w-4" /> Link {chip.reference}
          </Button>
        </div>
      ) : null}
      <ActionFeedback className="mt-2" phase={linkOp.phase} error={linkOp.error} onRetry={() => void linkOp.retry()} onRelease={linkOp.release} />
    </form>
  );
}

function OtherPaperBox({ doc, onChange }: { doc: OutwardDocument; onChange: (next: OutwardDocument) => void }) {
  const [reference, setReference] = useState("");
  const [party, setParty] = useState("");
  const [what, setWhat] = useState("");
  const linkOp = useLinkAction(doc, (next) => {
    onChange(next);
    setReference("");
    setParty("");
    setWhat("");
  });
  const valid = reference.trim().length > 0 && what.trim().length >= 5;
  return (
    <form
      className="rounded-xl border border-line bg-surface-2/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void linkOp.submit({ kind: "OTHER", reference: reference.trim(), party_name: party.trim(), reason: what.trim() });
      }}
    >
      <div className="text-[13px] font-semibold text-content-1">Paper not in the ERP</div>
      <p className="mt-0.5 text-[12px] text-content-3">For example a supplier return note or a courier receipt. Record its number so the photo is searchable.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Number on the paper" aria-label="Number on the paper" className="h-10 rounded-lg border border-line bg-surface-1 px-3 text-[13px] text-content-1 outline-none focus:border-primary" />
        <input value={party} onChange={(e) => setParty(e.target.value)} maxLength={255} placeholder="Party (optional)" aria-label="Party" className="h-10 rounded-lg border border-line bg-surface-1 px-3 text-[13px] text-content-1 outline-none focus:border-primary" />
      </div>
      <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={500} placeholder="What is it? (at least 5 characters)" aria-label="What is this paper" className="mt-2 h-10 w-full rounded-lg border border-line bg-surface-1 px-3 text-[13px] text-content-1 outline-none focus:border-primary" />
      <Button type="submit" size="sm" variant="outline" className="mt-2" disabled={!valid || linkOp.locked}>
        <Link2 className="h-4 w-4" /> Add paper
      </Button>
      <ActionFeedback className="mt-2" phase={linkOp.phase} error={linkOp.error} onRetry={() => void linkOp.retry()} onRelease={linkOp.release} />
    </form>
  );
}

function ScannedPanel({ doc }: { doc: OutwardDocument }) {
  if (!doc.scanned_refs.length) return null;
  return (
    <Panel title="Scanned at the gate" description="Every code the watchman scanned, including codes that were not recognised.">
      <ul className="space-y-1.5 text-[13px]">
        {doc.scanned_refs.map((row, index) => (
          <li key={index} className="flex items-start gap-2">
            {row.status === "LINKED" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />}
            <span className="min-w-0">
              {row.status === "LINKED" ? (
                <>
                  Linked <span className="font-mono font-semibold">{row.reference}</span> ({row.kind_label || OUTWARD_KIND_LABEL[row.kind as OutwardLinkKind] || row.kind})
                </>
              ) : row.status === "DUPLICATE_SCAN" ? (
                <>Same code scanned twice{row.reference ? ` (${row.reference})` : ""}</>
              ) : (
                <>
                  Not recognised: {row.error}
                  {row.code ? <span className="block break-all font-mono text-[11.5px] text-content-3">{row.code}</span> : null}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function FinishPanel({ doc, onChange, canVoid }: { doc: OutwardDocument; onChange: (next: OutwardDocument) => void; canVoid: boolean }) {
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const [voiding, setVoiding] = useState(false);
  const resolveOp = useGateOperation<{ reason: string }, OutwardDocument>({
    send: (payload) => outwardApi.resolve(doc.id, payload),
    onSaved: (next) => {
      onChange(next);
      setNote("");
      toast.success("Departure marked matched.");
    },
  });
  const discrepancyOp = useGateOperation<{ notes: string }, OutwardDocument>({
    send: (payload) => outwardApi.discrepancy(doc.id, payload),
    onSaved: (next) => {
      onChange(next);
      setIssue("");
      toast.success("Discrepancy noted.");
    },
  });
  const canResolve = doc.links.length > 0 && doc.status !== "MATCHED";
  return (
    <Panel title="Finish" description="Confirm the match, or note what is different so it can be followed up.">
      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (canResolve && !resolveOp.locked) void resolveOp.submit({ reason: note.trim() });
          }}
        >
          <label className="block text-[13px] font-semibold text-content-1" htmlFor="outward-match-note">
            Mark matched
          </label>
          <input id="outward-match-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" className="h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-content-1 outline-none focus:border-primary" />
          <Button type="submit" variant="success" disabled={!canResolve || resolveOp.locked}>
            <CheckCircle2 className="h-4 w-4" /> {doc.status === "MATCHED" ? "Already matched" : "Mark matched"}
          </Button>
          {!doc.links.length ? <p className="text-[12px] text-content-3">Link at least one ERP document first.</p> : null}
          <ActionFeedback phase={resolveOp.phase} error={resolveOp.error} onRetry={() => void resolveOp.retry()} onRelease={resolveOp.release} />
        </form>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (issue.trim().length >= 5 && !discrepancyOp.locked) void discrepancyOp.submit({ notes: issue.trim() });
          }}
        >
          <label className="block text-[13px] font-semibold text-content-1" htmlFor="outward-issue">
            Note a discrepancy
          </label>
          <textarea id="outward-issue" value={issue} onChange={(e) => setIssue(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Two bags short against DC-2627-0412" className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-content-1 outline-none focus:border-primary" />
          <Button type="submit" variant="warning" disabled={issue.trim().length < 5 || discrepancyOp.locked}>
            <ShieldAlert className="h-4 w-4" /> Save discrepancy
          </Button>
          <ActionFeedback phase={discrepancyOp.phase} error={discrepancyOp.error} onRetry={() => void discrepancyOp.retry()} onRelease={discrepancyOp.release} />
        </form>
      </div>
      {canVoid ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-[12.5px] text-content-3">Owner / Admin: void a record photographed by mistake or twice. Photos and time stay on record.</p>
          <Button type="button" variant="outline" onClick={() => setVoiding(true)}>
            <Ban className="h-4 w-4" /> Void record
          </Button>
        </div>
      ) : null}
      <ReasonDialog
        open={voiding}
        onOpenChange={setVoiding}
        title="Void this outward record?"
        description="All links are removed and a gate pass that left only on this record is reopened. This cannot be undone."
        confirmLabel="Void record"
        destructive
        placeholder="e.g. Same truck photographed twice"
        onSubmit={(payload) => outwardApi.void(doc.id, payload)}
        onDone={(next) => {
          onChange(next);
          toast.success("Outward record voided.");
        }}
      />
    </Panel>
  );
}

function HistoryPanel({ doc }: { doc: OutwardDocument }) {
  if (!doc.timeline?.length) return null;
  return (
    <Panel title="History" description="Every change, with who did it and why. Kept permanently.">
      <ol className="space-y-2 text-[13px]">
        {doc.timeline.map((event) => (
          <li key={event.id} className="flex gap-3">
            <span className="w-[132px] shrink-0 tabular-nums text-content-3">{docDateTime(event.created_at)}</span>
            <span className="min-w-0">
              <span className="font-semibold text-content-1">{ACTION_LABEL[event.action] ?? event.action}</span> · {event.actor_name}
              {event.reason ? <span className="block text-content-3">{event.reason}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
