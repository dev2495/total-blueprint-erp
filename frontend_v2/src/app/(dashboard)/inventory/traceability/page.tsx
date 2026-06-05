"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  Boxes,
  Factory,
  GitBranch,
  GitCommit,
  History,
  Layers,
  Search,
  Weight,
  CornerDownRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  observabilityApi,
  type RollTraceResponse,
  type GenealogyNode,
} from "@/services/observability";
import { listRolls, type Roll } from "@/services/rolls";
import Link from "next/link";

function fmtKg(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(3)} kg` : "—";
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

function statusTone(
  status?: string | null,
): "default" | "secondary" | "outline" {
  const key = String(status || "").toUpperCase();
  if (key === "AVAILABLE") return "default";
  if (key === "RESERVED" || key === "IN_PROCESS") return "secondary";
  return "outline";
}

function roleTone(role?: string | null): string {
  const key = String(role || "").toUpperCase();
  if (key === "REMAINDER")
    return "bg-warning-bg text-warning-fg border-warning-border";
  if (key === "OUTPUT" || key === "SPLIT_OUTPUT")
    return "bg-info-bg text-primary border-info-border";
  if (key === "FG")
    return "bg-success-bg text-success-fg border-success-border";
  return "bg-surface-2 text-content-2 border-line";
}

function NodeCard({
  node,
  isChild = false,
  isLast = false,
}: {
  node: GenealogyNode;
  isChild?: boolean;
  isLast?: boolean;
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div className="relative group">
      {/* Connector rendering if this card is a child in the branching tree */}
      {isChild && (
        <div
          className="absolute border-l-2 border-b-2 border-line-strong rounded-bl-xl"
          style={{ left: "-16px", top: "-16px", width: "16px", height: "40px" }}
        />
      )}
      {/* Continue the vertical line for siblings if not the last child */}
      {isChild && !isLast && (
        <div
          className="absolute border-l-2 border-line-strong"
          style={{ left: "-16px", top: "24px", bottom: "-16px" }}
        />
      )}

      <div
        className={cn(
          "relative z-10 rounded-2xl border bg-surface-1 px-4 py-3 shadow-sm transition-shadow hover:shadow-md",
          !isChild
            ? "border-info-border ring-4 ring-info-border"
            : "border-line",
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex items-start gap-3">
            {!isChild ? (
              <div className="bg-info-bg text-primary w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                <GitCommit className="h-5 w-5" />
              </div>
            ) : (
              <div className="bg-surface-2 text-content-3 w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                <CornerDownRight className="h-4 w-4" />
              </div>
            )}
            <div>
              <div className="font-black text-content-1 text-[15px] truncate flex items-center gap-2">
                {node.label_id}
                {node.job_number && (
                  <span className="text-[10px] bg-info-bg text-primary px-1.5 py-0.5 rounded-md uppercase font-bold tracking-wider">
                    Job {node.job_number}
                  </span>
                )}
              </div>
              <div className="text-xs text-content-3 font-semibold truncate flex items-center gap-1.5 mt-0.5">
                {node.material_name || "Unknown Material"}
                <span className="text-content-4">•</span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] uppercase font-black tracking-widest",
                    node.stage_index === 0
                      ? "bg-warning-bg text-warning-fg"
                      : "bg-success-bg text-success-fg",
                  )}
                >
                  {node.stage_name || `Stage ${node.stage_index ?? "—"}`}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-black tracking-wider uppercase",
                roleTone((node as any).roll_role),
              )}
            >
              {(node as any).roll_role || "ROLL"}
            </Badge>
            <Badge
              variant={statusTone(node.status)}
              className="text-[10px] font-black tracking-wider uppercase"
            >
              {node.status || "—"}
            </Badge>
          </div>
        </div>

        <div className="bg-surface-2 rounded-xl p-3 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs mt-3 border border-line">
          <div>
            <div className="text-content-4 uppercase tracking-[0.15em] text-[9px] font-black mb-1">
              Orig Weight
            </div>
            <div className="font-black text-content-2 text-sm flex items-center gap-1.5">
              {fmtKg(node.original_weight_kg)}
              {node.weight_kg !== node.original_weight_kg && (
                <span className="text-[9px] text-content-4 font-semibold bg-surface-1 border px-1 rounded">
                  now {fmtKg(node.weight_kg)}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-content-4 uppercase tracking-[0.15em] text-[9px] font-black mb-1">
              Dimensions
            </div>
            <div className="font-black text-content-2 text-sm">
              {Number(node.width_mm || 0) > 0
                ? `${Number(node.width_mm).toFixed(0)} mm`
                : "—"}{" "}
              <span className="text-content-4 font-normal mx-0.5">×</span>{" "}
              {Number(node.thickness_micron || 0) > 0
                ? `${Number(node.thickness_micron).toFixed(1)}μ`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-content-4 uppercase tracking-[0.15em] text-[9px] font-black mb-1">
              Location
            </div>
            <div className="font-semibold text-content-2 truncate">
              {node.location || "—"}
            </div>
          </div>
          <div>
            <div className="text-content-4 uppercase tracking-[0.15em] text-[9px] font-black mb-1">
              Created
            </div>
            <div className="font-semibold text-content-2 truncate">
              {fmtDate(node.created_at)}
            </div>
          </div>
        </div>
      </div>

      {hasChildren && (
        <div className="relative mt-4 pl-8">
          {node.children.map((child, idx) => (
            <NodeCard
              key={child.id}
              node={child as GenealogyNode}
              isChild={true}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RollTraceabilityPage() {
  const [query, setQuery] = useState("");
  const [selectedRoll, setSelectedRoll] = useState("");
  const [result, setResult] = useState<RollTraceResponse | null>(null);
  const [errorText, setErrorText] = useState("");

  const rollsQuery = useQuery({
    queryKey: ["traceability-roll-options"],
    queryFn: async () => listRolls(),
    staleTime: 60_000,
  });

  const rollOptions = useMemo(() => {
    const rows = Array.isArray(rollsQuery.data) ? rollsQuery.data : [];
    return rows
      .slice()
      .sort((a: Roll, b: Roll) => {
        const at = new Date(a.created_at || "").getTime();
        const bt = new Date(b.created_at || "").getTime();
        return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
      })
      .slice(0, 200);
  }, [rollsQuery.data]);

  const traceMutation = useMutation({
    mutationFn: async (value: string) => observabilityApi.getRollTrace(value),
    onSuccess: (data) => {
      setResult(data);
      setErrorText("");
    },
    onError: (err: any) => {
      setResult(null);
      setErrorText(err?.response?.data?.error || "Unable to trace this roll.");
    },
  });

  const currentRoll = result?.roll;
  const genealogy = result?.genealogy;
  const timeline = genealogy?.timeline || [];
  const childrenCount = useMemo(() => {
    function count(node?: GenealogyNode): number {
      if (!node || !Array.isArray(node.children)) return 0;
      return (
        node.children.length +
        node.children.reduce(
          (sum, child) => sum + count(child as GenealogyNode),
          0,
        )
      );
    }
    if (genealogy?.trees && Array.isArray(genealogy.trees)) {
      return genealogy.trees.reduce((acc, t) => acc + count(t), 0);
    }
    return 0;
  }, [genealogy?.trees]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eff6ff,#f8fafc_45%,#eef2ff)] p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <Card className="rounded-[2rem] border border-surface-1/60 bg-surface-1/70 backdrop-blur-xl shadow-xl">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-black tracking-tight text-content-1 flex items-center gap-2">
                  <GitBranch className="h-7 w-7 text-primary" />
                  Roll Genealogy
                </h1>
                <p className="text-sm text-content-3 font-semibold">
                  Genealogy, movement trail, and stage truth for any roll label
                  or id.
                </p>
              </div>
              {result?.matched_by && (
                <Badge
                  variant="outline"
                  className="font-bold uppercase text-[10px]"
                >
                  Match: {result.matched_by.replace("_", " ")}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="/inventory?tab=rolls">
                <Button
                  variant="outline"
                  className="h-12 rounded-2xl font-bold"
                >
                  Open Roll Explorer
                </Button>
              </Link>
              <Select
                value={selectedRoll}
                onValueChange={(value) => {
                  setSelectedRoll(value);
                  setQuery(value);
                  traceMutation.mutate(value);
                }}
              >
                <SelectTrigger className="h-12 w-[380px] rounded-2xl font-semibold">
                  <SelectValue
                    placeholder={
                      rollsQuery.isLoading
                        ? "Loading rolls..."
                        : "Select roll from latest 200"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {rollOptions.map((roll) => (
                    <SelectItem key={roll.id} value={roll.id}>
                      {roll.label_id} • {Number(roll.weight_kg || 0).toFixed(3)}{" "}
                      kg • {roll.stage_name || "—"} •{" "}
                      {roll.grade_name || "No grade"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-4" />
                <Input
                  className="pl-10 h-12 rounded-2xl font-semibold"
                  placeholder="Enter roll label (e.g. MattPet12 or R-S000001-... ) or UUID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query.trim())
                      traceMutation.mutate(query.trim());
                  }}
                />
              </div>
              <Button
                className="h-12 rounded-2xl px-6 font-black tracking-wider"
                disabled={traceMutation.isPending || !query.trim()}
                onClick={() => traceMutation.mutate(query.trim())}
              >
                {traceMutation.isPending ? "Tracing..." : "Trace Roll"}
              </Button>
            </div>
            {errorText && (
              <div className="text-sm font-semibold text-danger-fg">
                {errorText}
              </div>
            )}
          </CardContent>
        </Card>

        {currentRoll && genealogy && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card className="rounded-2xl border-line">
                <CardContent className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-black text-content-4">
                    Current Weight
                  </div>
                  <div className="text-2xl font-black text-content-1 mt-1">
                    {fmtKg(currentRoll.weight_kg)}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-line">
                <CardContent className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-black text-content-4">
                    Original Weight
                  </div>
                  <div className="text-2xl font-black text-content-1 mt-1">
                    {fmtKg(currentRoll.original_weight_kg)}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-line">
                <CardContent className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-black text-content-4">
                    Lineage Children
                  </div>
                  <div className="text-2xl font-black text-content-1 mt-1">
                    {childrenCount}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-line">
                <CardContent className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-black text-content-4">
                    Timeline Events
                  </div>
                  <div className="text-2xl font-black text-content-1 mt-1">
                    {timeline.length}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-line">
                <CardContent className="p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-black text-content-4">
                    Current Stage
                  </div>
                  <div className="text-lg font-black text-content-1 mt-2">
                    {currentRoll.stage_name || "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-[2rem] border border-surface-1/60 bg-surface-1/80">
              <CardContent className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded-2xl bg-surface-2 border border-line p-3">
                    <div className="text-[10px] text-content-4 font-black uppercase tracking-widest">
                      Roll
                    </div>
                    <div className="text-sm font-black text-content-1 mt-1">
                      {currentRoll.label_id}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-2 border border-line p-3">
                    <div className="text-[10px] text-content-4 font-black uppercase tracking-widest">
                      Material / Grade
                    </div>
                    <div className="text-sm font-black text-content-1 mt-1">
                      {currentRoll.material_name || "—"}
                    </div>
                    <div className="text-xs text-content-3 font-semibold">
                      {currentRoll.grade_name || "No grade"}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-2 border border-line p-3">
                    <div className="text-[10px] text-content-4 font-black uppercase tracking-widest">
                      Location
                    </div>
                    <div className="text-sm font-black text-content-1 mt-1 flex items-center gap-1">
                      <Factory className="h-3.5 w-3.5 text-primary" />
                      {currentRoll.plant_name || "—"}
                    </div>
                    <div className="text-xs text-content-3 font-semibold">
                      {currentRoll.location_name || "—"}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-2 border border-line p-3">
                    <div className="text-[10px] text-content-4 font-black uppercase tracking-widest">
                      Role / Status
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-bold uppercase",
                          roleTone(currentRoll.roll_role),
                        )}
                      >
                        {currentRoll.roll_role || "ROLL"}
                      </Badge>
                      <Badge
                        variant={statusTone(currentRoll.status)}
                        className="text-[10px] font-bold uppercase"
                      >
                        {currentRoll.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card className="rounded-[2rem] border border-surface-1/60 bg-surface-1/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-black tracking-wider uppercase text-content-2 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    Genealogy Tree
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 max-h-[700px] overflow-auto pr-2">
                  {(genealogy.trees || []).map((t, i) => (
                    <NodeCard key={t.id || i} node={t as GenealogyNode} />
                  ))}
                  {(!genealogy.trees || genealogy.trees.length === 0) && (
                    <div className="text-sm text-content-3 font-semibold py-6 text-center">
                      No tree data found.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border border-surface-1/60 bg-surface-1/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-black tracking-wider uppercase text-content-2 flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    Movement & Consumption Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[700px] overflow-auto pr-2">
                  {timeline.length === 0 && (
                    <div className="text-sm text-content-3 font-semibold py-6 text-center">
                      No timeline events recorded.
                    </div>
                  )}
                  {timeline.map((event: any, index: number) => (
                    <div
                      key={`${event.type}-${event.timestamp}-${index}`}
                      className="rounded-2xl border border-line bg-surface-2 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold uppercase"
                        >
                          {event.type || "EVENT"}
                        </Badge>
                        <span className="text-[11px] text-content-3 font-semibold">
                          {fmtDate(event.timestamp)}
                        </span>
                      </div>
                      {event.type === "MOVEMENT" ? (
                        <div className="mt-2 text-sm font-semibold text-content-2 flex items-center gap-2">
                          <ArrowRightLeft className="h-4 w-4 text-primary" />
                          {event.from || "NEW"} → {event.to || "—"}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm font-semibold text-content-2 flex items-center gap-2">
                          <Weight className="h-4 w-4 text-success-fg" />
                          {fmtKg(event.consumed_kg)}
                        </div>
                      )}
                      {event.reason && (
                        <div className="text-xs text-content-3 mt-1">
                          {event.reason}
                        </div>
                      )}
                      {event.job && (
                        <div className="text-xs text-primary mt-1 font-semibold">
                          Job: {event.job}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-[2rem] border border-surface-1/60 bg-surface-1/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-black tracking-wider uppercase text-content-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-success-fg" />
                  Recent Physical Movements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(result?.recent_movements || []).length === 0 ? (
                  <div className="text-sm text-content-3 font-semibold">
                    No movement events found.
                  </div>
                ) : (
                  (result?.recent_movements || []).map((m, idx) => (
                    <div
                      key={`move-${idx}`}
                      className="rounded-xl border border-line p-3 bg-surface-2"
                    >
                      <div className="text-[11px] text-content-3 font-semibold">
                        {fmtDate(m.timestamp)}
                      </div>
                      <div className="text-sm font-bold text-content-2 mt-1">
                        {m.from_location_name || "NEW"} →{" "}
                        {m.to_location_name || "—"}
                      </div>
                      <div className="text-xs text-content-3 mt-1">
                        {m.reason || "—"}{" "}
                        {m.reason_note ? `• ${m.reason_note}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!currentRoll && !traceMutation.isPending && (
          <Card className="rounded-[2rem] border border-dashed border-line-strong bg-surface-1/40">
            <CardContent className="p-12 text-center">
              <Boxes className="h-12 w-12 text-content-4 mx-auto mb-3" />
              <div className="text-content-3 font-semibold">
                Search a roll label or UUID to view full traceability.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
