"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  Boxes,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  reorderPolicyApi,
  type ReorderPolicyRow,
} from "@/services/reorder-policy";
import { formatDisplayDate } from "@/lib/date-format";

const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All categories" },
  { value: "FILM_FAMILY", label: "Film families" },
  { value: "FILM_VARIANT", label: "Film variants" },
  { value: "GRANULE", label: "Granules" },
  { value: "INK", label: "Inks" },
  { value: "SOLVENT", label: "Solvents" },
  { value: "ADHESIVE", label: "Adhesives" },
  { value: "PACKAGING", label: "Packaging" },
  { value: "ADDON", label: "Add-ons" },
  { value: "POD", label: "POD films" },
];

function pct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function ReorderRow({
  row,
  onSaved,
}: {
  row: ReorderPolicyRow;
  onSaved: (next: ReorderPolicyRow) => void;
}) {
  const [reorder, setReorder] = useState<string>(
    row.reorder_qty == null ? "" : String(row.reorder_qty),
  );
  const [safety, setSafety] = useState<string>(
    row.safety_stock == null ? "" : String(row.safety_stock),
  );
  const [lead, setLead] = useState<string>(
    row.lead_time_override_days == null
      ? ""
      : String(row.lead_time_override_days),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const reorderNum = Number(reorder || 0);
  const safetyNum = Number(safety || 0);
  const stock = row.current_stock || 0;
  const below = reorderNum > 0 && stock < reorderNum;
  const critical = safetyNum > 0 && stock < safetyNum;

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, number | null> = {};
      payload.reorder_qty = reorder === "" ? null : Number(reorder);
      payload.safety_stock = safety === "" ? null : Number(safety);
      payload.lead_time_override_days = lead === "" ? null : Number(lead);
      const next = await reorderPolicyApi.patch(
        row.id,
        payload as Partial<ReorderPolicyRow>,
      );
      onSaved(next);
      toast({ title: "Saved", description: `${row.code}: policy updated.` });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-surface-2">
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold text-content-1">
            {row.code}
          </span>
          <span className="text-[11px] text-content-3">{row.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        <Badge
          variant="outline"
          className="rounded-full text-[10px] font-semibold uppercase tracking-wide"
        >
          {row.category_label}
        </Badge>
      </td>
      <td className="px-4 py-3 align-middle font-mono text-sm">
        <div className="flex items-center gap-2">
          <span
            className={
              critical
                ? "text-danger-fg font-bold"
                : below
                  ? "text-warning-fg font-bold"
                  : "text-content-2"
            }
          >
            {stock.toFixed(2)}
          </span>
          <span className="text-[10px] uppercase text-content-4">
            {row.base_uom}
          </span>
          {critical ? (
            <Badge className="rounded-full bg-danger-bg text-[10px] font-bold uppercase text-danger-fg">
              CRITICAL
            </Badge>
          ) : below ? (
            <Badge className="rounded-full bg-warning-bg text-[10px] font-bold uppercase text-warning-fg">
              LOW
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 align-middle">
        <Input
          className="h-9 w-24 rounded-md text-right font-mono text-sm"
          inputMode="decimal"
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
          placeholder="—"
        />
      </td>
      <td className="px-3 py-3 align-middle">
        <Input
          className="h-9 w-24 rounded-md text-right font-mono text-sm"
          inputMode="decimal"
          value={safety}
          onChange={(e) => setSafety(e.target.value)}
          placeholder="—"
        />
      </td>
      <td className="px-3 py-3 align-middle">
        <Input
          className="h-9 w-20 rounded-md text-right font-mono text-sm"
          inputMode="numeric"
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          placeholder="—"
        />
      </td>
      <td className="px-4 py-3 align-middle text-[11px] text-content-3">
        {row.last_alert_at
          ? formatDisplayDate(row.last_alert_at)
          : "—"}
      </td>
      <td className="px-3 py-3 align-middle text-right">
        <Button
          size="sm"
          className="h-8 rounded-full bg-surface-3 text-white hover:bg-line"
          disabled={saving}
          onClick={save}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </td>
    </tr>
  );
}

export default function ReorderPolicyPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [category, setCategory] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");
  const [onlyMissing, setOnlyMissing] = useState<boolean>(false);

  const listQuery = useQuery({
    queryKey: ["reorder-policy", category, search, onlyMissing],
    queryFn: () =>
      reorderPolicyApi.list({
        category: category === "ALL" ? undefined : category,
        search: search || undefined,
        no_policy: onlyMissing || undefined,
      }),
    staleTime: 30_000,
  });

  const rows = listQuery.data ?? [];

  const scanMutation = useMutation({
    mutationFn: () => reorderPolicyApi.runScan(),
    onSuccess: (result) => {
      toast({
        title: "Reorder scan complete",
        description: `Scanned ${result.scanned} · raised ${result.raised} · resolved ${result.resolved}`,
      });
      queryClient.invalidateQueries({ queryKey: ["reorder-policy"] });
    },
    onError: (err) => {
      toast({
        title: "Scan failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const stats = useMemo(() => {
    const withPolicy = rows.filter(
      (r) => r.reorder_qty != null && Number(r.reorder_qty) > 0,
    );
    const belowReorder = withPolicy.filter(
      (r) => (r.current_stock ?? 0) < Number(r.reorder_qty ?? 0),
    );
    const belowSafety = withPolicy.filter(
      (r) =>
        r.safety_stock != null &&
        (r.current_stock ?? 0) < Number(r.safety_stock ?? 0),
    );
    return {
      total: rows.length,
      withPolicy: withPolicy.length,
      belowReorder: belowReorder.length,
      belowSafety: belowSafety.length,
      coverage: rows.length === 0 ? 0 : withPolicy.length / rows.length,
    };
  }, [rows]);

  return (
    <div className="min-h-screen space-y-6 bg-surface-2 p-6">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-surface-3 via-surface-3 to-surface-3 px-8 py-7 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              System Settings
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              Reorder &amp; safety stock policy
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-content-4">
              Set the reorder point and safety buffer for every material the
              plant consumes. Anything below the reorder point raises a
              low-stock alert; anything below safety stock is flagged HIGH
              severity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-full border-surface-1/20 bg-surface-1/10 text-white hover:bg-surface-1/20"
              onClick={() => listQuery.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              className="rounded-full bg-surface-1 text-content-1 hover:bg-surface-2"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
            >
              {scanMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BellRing className="mr-2 h-4 w-4" />
              )}
              Run reorder scan
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<Boxes className="h-4 w-4" />}
          label="Materials"
          value={String(stats.total)}
          hint="Active inventory rows"
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Coverage"
          value={pct(stats.coverage)}
          hint={`${stats.withPolicy} with reorder set`}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Below reorder"
          value={String(stats.belowReorder)}
          hint="Need replenishment"
          tone="warn"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Below safety"
          value={String(stats.belowSafety)}
          hint="Production at risk"
          tone="critical"
        />
      </div>

      <Card className="border-line">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-black text-content-1">
            <Filter className="h-5 w-5 text-primary" />
            Filter
          </CardTitle>
          <CardDescription>
            Narrow the table to a specific category or search across codes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-content-4" />
            <Input
              className="h-10 w-64 rounded-full"
              placeholder="Search code or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-56 rounded-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={onlyMissing ? "default" : "outline"}
            className="h-10 rounded-full"
            onClick={() => setOnlyMissing((v) => !v)}
          >
            Only materials without policy
          </Button>
        </CardContent>
      </Card>

      <Card className="border-line">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-black text-content-1">
              Materials
            </CardTitle>
            <CardDescription>
              Inline edit. Save updates the policy on the InventoryMaterial row.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {listQuery.isLoading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-content-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading materials…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-content-3">
              No materials match the current filter.
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[10px] font-bold uppercase tracking-wide text-content-3">
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-3 py-3 text-right">Reorder qty</th>
                  <th className="px-3 py-3 text-right">Safety stock</th>
                  <th className="px-3 py-3 text-right">Lead days</th>
                  <th className="px-4 py-3">Last alert</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ReorderRow
                    key={row.id}
                    row={row}
                    onSaved={(next) => {
                      queryClient.setQueryData<ReorderPolicyRow[] | undefined>(
                        ["reorder-policy", category, search, onlyMissing],
                        (prev) =>
                          (prev || []).map((r) =>
                            r.id === next.id ? next : r,
                          ),
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "critical";
}) {
  const toneClasses =
    tone === "critical"
      ? "border-danger-border bg-gradient-to-br from-danger-bg to-white"
      : tone === "warn"
        ? "border-warning-border bg-gradient-to-br from-warning-bg to-white"
        : "border-line bg-surface-1";
  return (
    <Card className={`rounded-2xl ${toneClasses}`}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-content-3">
          {icon}
          {label}
        </div>
        <div className="mt-2 font-mono text-3xl font-black tracking-tight text-content-1">
          {value}
        </div>
        {hint ? (
          <div className="mt-1 text-xs text-content-3">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
