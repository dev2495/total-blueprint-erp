"use client";

import { inchesText } from "@/lib/size-naming";
import * as React from "react";

import { StackBar } from "@/components/planner-kit";
import { cn } from "@/lib/utils";
import type { Roll } from "@/services/inventory";

/**
 * Rolls by film: one card per film (material × micron), its rolls racked by width. Each roll is
 * drawn to scale by weight; the body is the film's colour and the ring its state (free,
 * reserved, on a machine, away at a job worker or on the road). Click a roll to open it.
 */

type RollState = "free" | "reserved" | "process" | "away";

const STATE: Record<RollState, { label: string; ring: string; tone: "done" | "run" | "queued" | "wait" }> = {
  free: { label: "Free", ring: "rgb(var(--success-fg-rgb))", tone: "done" },
  reserved: { label: "Reserved", ring: "rgb(var(--order-fg-rgb))", tone: "run" },
  process: { label: "On machine", ring: "var(--info-fg)", tone: "queued" },
  away: { label: "Away", ring: "rgb(var(--warning-fg-rgb))", tone: "wait" },
};

export function rollState(roll: Roll | any): RollState {
  const status = String(roll?.status || "").toUpperCase();
  if (status === "IN_PROCESS" || status === "ISSUED" || status === "ON_MACHINE") return "process";
  if (["IN_TRANSIT", "SENT_JOBWORK", "AT_JOBWORKER", "JOBWORK"].includes(status)) return "away";
  if (status === "RESERVED" || roll?.reserved_for_so_id || roll?.reserved_for_job || roll?.is_reserved) return "reserved";
  return "free";
}

/** Film body colour from the material name/code (theme tokens). */
function filmColour(roll: Roll | any) {
  const text = `${roll?.material_code || ""} ${roll?.material_name || ""} ${roll?.family_name || ""}`.toUpperCase();
  if (/VMPET|MET|ALU|FOIL/.test(text)) return "var(--film-met)";
  if (/PET|POLYESTER/.test(text)) return "var(--film-pet)";
  if (/BOPP|CPP|\bPP\b|\bTT\b/.test(text)) return "var(--film-pp)";
  if (/LD|LLD|PE\b|POLYETHYLENE|METALLOCENE/.test(text)) return "var(--film-pe)";
  if (/NY|NYLON/.test(text)) return "var(--film-ny)";
  if (/PAPER/.test(text)) return "var(--film-paper)";
  return "var(--film-other)";
}

const kgText = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: value < 100 ? 1 : 0 });

function RollGlyph({ roll, size }: { roll: Roll; size: number }) {
  const state = rollState(roll);
  const r = size / 2 - 1.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill={filmColour(roll)} stroke={STATE[state].ring} strokeWidth={2} />
      <circle cx={size / 2} cy={size / 2} r={Math.max(2.5, r * 0.22)} fill="var(--surface-1)" stroke={STATE[state].ring} strokeWidth={1} />
    </svg>
  );
}

type Film = {
  key: string;
  name: string;
  code: string;
  micron: number;
  rolls: Roll[];
  kg: Record<RollState, number>;
  total: number;
  widths: Array<{ width: number; rolls: Roll[]; kg: number }>;
  oldest: number;
};

function buildFilms(rolls: Roll[]): Film[] {
  const map = new Map<string, Film>();
  for (const roll of rolls) {
    const micron = Number(roll.thickness_micron || 0);
    const key = `${roll.material_code || roll.material_name}|${micron}`;
    let film = map.get(key);
    if (!film) {
      film = {
        key,
        name: roll.material_name || roll.material_code || "Film",
        code: roll.material_code || "",
        micron,
        rolls: [],
        kg: { free: 0, reserved: 0, process: 0, away: 0 },
        total: 0,
        widths: [],
        oldest: 0,
      };
      map.set(key, film);
    }
    const kg = Number(roll.weight_kg || roll.net_weight_kg || 0);
    film.rolls.push(roll);
    film.kg[rollState(roll)] += kg;
    film.total += kg;
    film.oldest = Math.max(film.oldest, Number(roll.age_days || 0));
  }
  for (const film of map.values()) {
    const byWidth = new Map<number, Roll[]>();
    for (const roll of film.rolls) {
      const width = Number(roll.width_mm || 0);
      byWidth.set(width, [...(byWidth.get(width) || []), roll]);
    }
    film.widths = Array.from(byWidth.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([width, rows]) => ({
        width,
        rolls: rows.sort((a, b) => Number(b.weight_kg || 0) - Number(a.weight_kg || 0)),
        kg: rows.reduce((sum, row) => sum + Number(row.weight_kg || 0), 0),
      }));
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

const SHOW_PER_WIDTH = 18;

export function RollFilmBoard({
  rolls,
  loading,
  onSelect,
}: {
  rolls: Roll[];
  loading?: boolean;
  onSelect: (roll: Roll) => void;
}) {
  const films = React.useMemo(() => buildFilms(rolls), [rolls]);
  const maxKg = React.useMemo(() => Math.max(1, ...rolls.map((roll) => Number(roll.weight_kg || 0))), [rolls]);
  const glyphSize = (kg: number) => Math.round(18 + Math.sqrt(Math.max(kg, 0) / maxKg) * 22);

  if (loading) {
    return <div className="rounded-[14px] border border-line bg-surface-1 p-6 text-sm text-content-3">Loading rolls…</div>;
  }
  if (!films.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-line-strong bg-surface-1 p-6 text-center text-sm text-content-3">
        No rolls match these filters.
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="roll-film-board">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-content-3" aria-label="Legend">
        {(Object.keys(STATE) as RollState[]).map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <circle cx="7" cy="7" r="5.5" fill="var(--surface-2)" stroke={STATE[state].ring} strokeWidth="2" />
            </svg>
            {STATE[state].label}
          </span>
        ))}
        <span>· size = weight · fill = film</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {films.map((film) => (
          <section key={film.key} className="min-w-0 rounded-[14px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]" aria-label={`${film.name} ${film.micron} micron`}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-9 w-2.5 shrink-0 rounded-full" style={{ background: filmColour(film.rolls[0]) }} aria-hidden />
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-content-1">
                    {film.name} <span className="font-mono text-[13px] text-content-3">{film.micron} µm</span>
                  </div>
                  <div className="font-mono text-caption text-content-3">
                    {film.code} · {film.widths.length} width{film.widths.length === 1 ? "" : "s"} · oldest {film.oldest} d
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[17px] font-semibold tabular-nums text-content-1">
                  {kgText(film.total)} <span className="text-caption font-medium text-content-3">kg</span>
                </div>
                <div className="text-caption text-content-3">
                  {film.rolls.length} roll{film.rolls.length === 1 ? "" : "s"} · {kgText(film.kg.free)} kg free
                </div>
              </div>
              <div className="w-full">
                <StackBar
                  legend={false}
                  segments={(Object.keys(STATE) as RollState[]).map((state) => ({ label: STATE[state].label, value: film.kg[state], tone: STATE[state].tone }))}
                />
              </div>
            </header>
            <div className="divide-y divide-line">
              {film.widths.map((band) => (
                <div key={band.width} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5">
                  <div>
                    <div className="font-mono text-[13px] font-semibold text-content-1">{band.width} mm</div>
                    <div className="font-mono text-[13px] font-semibold tabular-nums text-content-2">{inchesText(band.width)}</div>
                    <div className="text-[11.5px] text-content-3">
                      {band.rolls.length} · {kgText(band.kg)} kg
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {band.rolls.slice(0, SHOW_PER_WIDTH).map((roll) => {
                      const kg = Number(roll.weight_kg || 0);
                      const state = rollState(roll);
                      return (
                        <button
                          key={roll.id}
                          type="button"
                          onClick={() => onSelect(roll)}
                          className={cn("grid place-items-center rounded-full p-0.5 transition hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-order")}
                          aria-label={`${roll.label_id}: ${kgText(kg)} kg, ${STATE[state].label.toLowerCase()}, ${roll.location_name || "no location"}`}
                          title={`${roll.label_id} · ${kgText(kg)} kg · ${STATE[state].label} · ${roll.location_name || "—"} · ${roll.age_days ?? 0} d`}
                          data-testid="roll-film-glyph"
                        >
                          <RollGlyph roll={roll} size={glyphSize(kg)} />
                        </button>
                      );
                    })}
                    {band.rolls.length > SHOW_PER_WIDTH ? (
                      <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-caption text-content-3">
                        +{band.rolls.length - SHOW_PER_WIDTH} more
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
