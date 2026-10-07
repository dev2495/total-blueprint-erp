"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";

import { gateApi } from "@/services/gate";
import { useGate } from "./gate-shell";
import { GateAction, GateMark } from "./gate-ui";

/**
 * Printable gate sign. The QR is the backend's real SVG (HIGH error
 * correction, 4-module quiet zone) shown as an <img>, so its modules are
 * never redrawn or scripted here. The TPP mark is optional: a small centre
 * badge covering ~3% of the symbol, well inside level-H recovery (~30%).
 */
export function GateQrPoster() {
  const { plants, plantId, setPlantId } = useGate();
  const [withMark, setWithMark] = useState(true);
  const meta = useQuery({
    queryKey: ["gate", "qr", plantId],
    queryFn: () => gateApi.plantQr(plantId),
    enabled: Boolean(plantId),
    meta: { suppressGlobalError: true },
  });
  const svg = useQuery({
    queryKey: ["gate", "qr-svg", plantId],
    queryFn: () => gateApi.plantQrSvg(plantId),
    enabled: Boolean(plantId),
    meta: { suppressGlobalError: true },
  });
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const svgText = svg.data && svg.data.includes("<svg") ? svg.data : null;

  useEffect(() => {
    if (!svgText) {
      setSvgUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    setSvgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [svgText]);

  const download = () => {
    if (!svgText) return;
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tpp-gate-qr-${meta.data?.plant_code || "plant"}.svg`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const publicUrl = meta.data?.public_url ?? "";
  const shortUrl = publicUrl.replace(/^https?:\/\//, "");

  return (
    <div className="gate-print-root space-y-4">
      {/* Rendered only on this page, so the A4/zero-margin rule never affects other ERP prints. */}
      <style>{`@page { size: A4 portrait; margin: 0; }`}</style>
      <div className="gate-no-print flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-4">Admin · Owner</div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-content-1">Visitor QR poster</h1>
          <p className="text-[14px] text-content-3">Print and fix at the gate. Each plant has its own link; visitors land straight on that gate&apos;s form.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plants.length > 1 ? (
            <select className="gate-field !w-auto min-w-[180px]" value={plantId} onChange={(e) => setPlantId(e.target.value)} aria-label="Plant">
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <label className="flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl border border-line bg-surface-1 px-4 text-[14px] font-semibold text-content-2">
            <input type="checkbox" checked={withMark} onChange={(e) => setWithMark(e.target.checked)} className="h-5 w-5 accent-[var(--gate-in)]" />
            Centre logo
          </label>
          <GateAction tone="plain" size="md" onClick={download} disabled={!svgText}>
            <Download className="h-5 w-5" /> SVG
          </GateAction>
          <GateAction tone="ink" size="md" onClick={() => window.print()} disabled={!svgUrl}>
            <Printer className="h-5 w-5" /> Print
          </GateAction>
        </div>
      </div>

      {meta.isError || svg.isError ? (
        <div className="gate-card p-5 text-[14px] text-content-3">
          The gate QR for this plant could not be loaded. Try again in a moment; if it keeps failing, contact the system administrator.
          <div className="mt-3">
            <GateAction tone="plain" size="md" onClick={() => { void meta.refetch(); void svg.refetch(); }}>
              Try again
            </GateAction>
          </div>
        </div>
      ) : (
        <article
          className="gate-poster mx-auto w-full max-w-[600px] overflow-hidden rounded-[28px] bg-white text-[#0b0f19] shadow-[var(--gate-shadow)]"
          style={{ aspectRatio: "210 / 297" }}
        >
          <div className="flex h-full flex-col">
            <header className="flex items-center gap-3 px-[7%] pb-[4%] pt-[6%]" style={{ background: "var(--gate-ink)", color: "#fff" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/tpp-logo-mark.svg" alt="" className="h-[clamp(36px,7vw,52px)] w-auto rounded-xl bg-white p-1.5" />
              <div className="leading-tight">
                <div className="text-[clamp(16px,3.2vw,24px)] font-semibold tracking-[-0.01em]">Total Poly Print</div>
                <div className="text-[clamp(11px,2vw,14px)] opacity-75">{meta.data?.plant_name || "Factory gate"}</div>
              </div>
            </header>
            <div className="flex flex-1 flex-col items-center px-[8%] pt-[6%] text-center">
              <h2 className="text-[clamp(26px,6vw,44px)] font-bold leading-[1.05] tracking-[-0.03em]">Visitor? Scan to register</h2>
              <p className="mt-1 text-[clamp(14px,2.8vw,20px)] font-medium text-[#3b4252]">आगंतुक? पंजीकरण के लिए स्कैन करें</p>

              <div className="relative mt-[6%] aspect-square w-[66%]">
                {svgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={svgUrl} alt={`QR code linking to ${shortUrl}`} className="h-full w-full [image-rendering:pixelated]" />
                ) : (
                  <div className="h-full w-full animate-pulse rounded-2xl bg-[#eef0f4]" />
                )}
                {svgUrl && withMark ? (
                  <div
                    className="absolute left-1/2 top-1/2 flex aspect-square w-[16%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[18%] bg-white p-[2.2%]"
                    style={{ boxShadow: "0 0 0 2px #fff" }}
                    aria-hidden
                  >
                    <GateMark className="h-full w-full" />
                  </div>
                ) : null}
              </div>

              <div className="mt-[3%] break-all font-mono text-[clamp(10px,1.8vw,13px)] text-[#535c6d]">{shortUrl}</div>

              <ol className="mt-auto grid w-full grid-cols-3 gap-3 pb-[7%] pt-[5%] text-left">
                {[
                  ["1", "Scan", "Open your phone camera"],
                  ["2", "Submit", "Your entry is recorded"],
                  ["3", "Exit", "The watchman checks you out"],
                ].map(([n, title, body]) => (
                  <li key={n} className="rounded-2xl bg-[#f4f5f8] p-[clamp(8px,2vw,14px)]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: n === "3" ? "#d9651c" : "#1068a9" }}>
                      {n}
                    </div>
                    <div className="mt-1.5 text-[clamp(13px,2.4vw,17px)] font-semibold">{title}</div>
                    <div className="text-[clamp(10px,1.8vw,13px)] leading-snug text-[#535c6d]">{body}</div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </article>
      )}
      <p className="gate-no-print px-1 text-center text-[12px] text-content-4">
        Test before fixing: scan the printed sign with two different phones. The link opens only this gate&apos;s visitor form; submitting records entry, and the watchman confirms exit.
      </p>
    </div>
  );
}
