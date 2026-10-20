"use client";

/**
 * Coming back in: the watchman scans the QR on one of our own papers (inter-plant challan, job-work
 * challan or returnable gate pass) when the goods come back through the gate. Saved once; the store
 * is told to receive it. Nothing moves in stock from here.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, DoorOpen, Loader2, ScanLine, TriangleAlert } from "lucide-react";

import { goodsMovementsApi, type ArrivalPreview, type GateArrival } from "@/services/goods-movements";

import { useGate } from "./gate-shell";
import { gateTime } from "./gate-format";
import { GateAction, GateSheet, OperationBanner, SectionHeading } from "./gate-ui";
import { FactoryChoice } from "./page-capture";
import { QrScanner } from "./qr-scanner";
import { gateErrorMessage, useGateOperation } from "./use-gate-operation";

const TONE = "var(--gate-in)";

export function ArrivalCapture() {
  const { plants, plant, plantId, setPlantId } = useGate();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<ArrivalPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [vehicle, setVehicle] = useState("");

  const todayQ = useQuery({
    queryKey: ["gate", "arrivals", plantId],
    queryFn: () => goodsMovementsApi.arrivals(plantId),
    enabled: Boolean(plantId),
    refetchInterval: 60_000,
  });

  const op = useGateOperation<{ plant: string; code: string; vehicle_number: string }, { arrival: GateArrival }>({
    send: (payload) => goodsMovementsApi.recordArrival(payload),
    onSaved: () => {
      qc.invalidateQueries({ queryKey: ["gate", "arrivals"] });
    },
  });
  const locked = op.phase === "sending" || op.phase === "uncertain";

  const onCode = async (raw: string) => {
    setScanning(false);
    if (!plantId) return;
    setCode(raw);
    setPreview(null);
    setCheckError("");
    setChecking(true);
    try {
      setPreview(await goodsMovementsApi.previewArrival({ plant: plantId, code: raw }));
    } catch (error) {
      setCheckError(gateErrorMessage(error, "This paper cannot be recorded here."));
    } finally {
      setChecking(false);
    }
  };

  const reset = () => {
    setCode("");
    setPreview(null);
    setCheckError("");
    setVehicle("");
    op.reset();
  };

  const saved = op.phase === "saved" ? op.result?.arrival : null;
  const vehicleText = vehicle.trim().toUpperCase();

  return (
    <div className="mx-auto max-w-[640px] space-y-5" data-testid="gate-arrival">
      <div className="px-1 pt-1">
        <div className="text-[13px] font-medium text-content-3">Our paper coming back</div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Goods coming back in</h1>
        <p className="mt-1 text-[14px] leading-5 text-content-3">
          For goods of ours returning: from another of our factories, from a job worker, or a part back from repair. Scan the QR on our paper.
          A supplier&apos;s bill still goes through Inward → Take bill photo.
        </p>
      </div>

      <FactoryChoice plants={plants} plant={plant} plantId={plantId} setPlantId={setPlantId} locked={locked || Boolean(code)} tone={TONE} headingId="arrival-factory" />

      {saved ? (
        <div className="gate-card space-y-3 p-5" role="status">
          <div className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: TONE }}>
            <CheckCircle2 className="h-6 w-6" /> Recorded at {gateTime(saved.arrived_at)}
          </div>
          <div className="text-[15px] font-semibold text-content-1">
            {saved.kind_label}: {saved.reference}
          </div>
          <div className="text-[14px] text-content-3">{saved.party_name}{saved.vehicle_number ? ` · ${saved.vehicle_number}` : ""}</div>
          <div className="text-[13px] text-content-3">The store has been told to receive it.</div>
          <GateAction tone="in" onClick={reset} className="w-full">
            Record another
          </GateAction>
        </div>
      ) : (
        <section className="space-y-3">
          <GateAction tone="in" onClick={() => setScanning(true)} disabled={locked || !plantId} className="w-full" data-testid="arrival-scan">
            <ScanLine className="h-5 w-5" /> {code ? "Scan a different paper" : "Scan the QR on our paper"}
          </GateAction>

          {checking ? (
            <div className="gate-card flex items-center gap-2 p-4 text-[14px] text-content-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking the paper…
            </div>
          ) : null}
          {checkError ? (
            <div className="gate-card flex items-start gap-2 p-4 text-[14px] font-medium" style={{ color: "var(--gate-alert)" }} role="alert">
              <TriangleAlert className="mt-0.5 h-5 w-5 flex-none" /> {checkError}
            </div>
          ) : null}

          {preview ? (
            <div className="gate-card space-y-3 p-5" data-testid="arrival-preview">
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: TONE }}>
                <DoorOpen className="h-4 w-4" /> {preview.kind_label}
              </div>
              <div className="text-[19px] font-semibold text-content-1">{preview.reference}</div>
              <div className="text-[15px] text-content-2">{preview.party_name}</div>
              {preview.summary ? <div className="text-[14px] text-content-3">{preview.summary}</div> : null}
              {preview.warnings?.length ? (
                <ul className="space-y-1">
                  {preview.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--gate-alert)" }}>
                      <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" /> {w}
                    </li>
                  ))}
                </ul>
              ) : null}
              <label className="block text-[14px] font-semibold text-content-1" htmlFor="arrival-vehicle">
                Vehicle number <span className="font-normal text-content-3">(if any)</span>
              </label>
              <input
                id="arrival-vehicle"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                disabled={locked}
                className="gate-input min-h-[52px] w-full rounded-2xl border border-line bg-surface-1 px-4 font-mono text-[17px] text-content-1"
                placeholder="GJ15AB1234"
                autoComplete="off"
              />
              <OperationBanner phase={op.phase} error={op.error} onRetry={() => void op.retry()} onRelease={op.release} />
              <GateAction
                tone="in"
                className="w-full"
                busy={op.phase === "sending"}
                disabled={locked || !plantId}
                onClick={() => void op.submit({ plant: plantId, code, vehicle_number: vehicleText })}
                data-testid="arrival-save"
              >
                Record back at the gate
              </GateAction>
            </div>
          ) : null}
        </section>
      )}

      <section>
        <SectionHeading eyebrow="Today at this gate" title="Recorded back in" />
        {todayQ.data?.length ? (
          <ul className="space-y-2">
            {todayQ.data.map((row) => (
              <li key={row.id} className="gate-card flex items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-content-1">{row.reference}</span>
                  <span className="block truncate text-[13px] text-content-3">
                    {row.kind_label} · {row.party_name}
                  </span>
                </span>
                <span className="gate-num flex-none text-[14px] text-content-2">{gateTime(row.arrived_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="gate-card p-4 text-[14px] text-content-3">{todayQ.isLoading ? "Loading…" : "Nothing recorded back in today."}</div>
        )}
      </section>

      <GateSheet open={scanning} onOpenChange={setScanning} title="Scan the QR on our paper" description={plant ? `Gate: ${plant.name}` : undefined} tall>
        {scanning ? <QrScanner onCode={(raw) => void onCode(raw)} onClose={() => setScanning(false)} /> : null}
      </GateSheet>
    </div>
  );
}
