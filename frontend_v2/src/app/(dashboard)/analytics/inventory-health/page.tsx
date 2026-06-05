"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  AlertTriangle,
  Boxes,
  CircleDot,
  RefreshCw,
  CheckCircle2,
  Activity,
  ShieldCheck,
  CheckSquare,
  Gauge,
} from "lucide-react";
import {
  observabilityApi,
  type InventoryHealth,
  type InventoryAlert,
} from "@/services/observability";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import { useInView } from "react-intersection-observer";

function ScrollTriggeredChart({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, inView } = useInView({ threshold: 0.1 });
  return (
    <div ref={ref} className={className}>
      {inView ? children : null}
    </div>
  );
}

export default function InventoryHealthPage() {
  const [health, setHealth] = useState<InventoryHealth | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [auditRunning, setAuditRunning] = useState(false);

  const loadData = async () => {
    try {
      setRefreshing(true);
      setError(null);
      const [healthData, alertsData] = await Promise.all([
        observabilityApi.getHealth(),
        observabilityApi.getAlerts({ resolved: false }),
      ]);
      setHealth(healthData);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    } catch (err: any) {
      console.error("Failed to load health data:", err);
      setError(err?.message || "Failed to load data");
      setHealth({
        bulk: { total_kg: 0, sku_count: 0 },
        rolls: {
          available_count: 0,
          available_kg: 0,
          reserved_count: 0,
          reserved_kg: 0,
          fg_count: 0,
          fg_kg: 0,
        },
        alerts: { total_open: 0, critical: 0, high: 0 },
      });
      setAlerts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRunAudit = async () => {
    setAuditRunning(true);
    try {
      await observabilityApi.runAudit();
      toast.success("Health audit initiated");
      await loadData();
    } catch (e) {
      toast.error("Failed to run audit");
    } finally {
      setAuditRunning(false);
    }
  };

  const handleResolve = async () => {
    if (!resolvingId) return;
    try {
      await observabilityApi.resolveAlert(resolvingId, resolveNote);
      toast.success("Alert resolved");
      setResolvingId(null);
      setResolveNote("");
      loadData();
    } catch (e) {
      toast.error("Failed to resolve alert");
    }
  };

  if (loading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const safeHealth = health || {
    bulk: { total_kg: 0, sku_count: 0 },
    rolls: {
      available_count: 0,
      available_kg: 0,
      reserved_count: 0,
      reserved_kg: 0,
      fg_count: 0,
      fg_kg: 0,
    },
    alerts: { total_open: 0, critical: 0, high: 0 },
  };

  // Calculate dynamic System Integrity % based on penalty of active errors vs total expected rows loosely defined
  // Max penalty points approach: Critical (-5%), High (-2%), Medium (-0.5%)
  const maxScore = 100;
  const criticalPenalty = safeHealth.alerts.critical * 5;
  const highPenalty = safeHealth.alerts.high * 2;
  const mediumCount =
    safeHealth.alerts.total_open -
    safeHealth.alerts.critical -
    safeHealth.alerts.high;
  const mediumPenalty = mediumCount * 0.5;
  const integrityScore = Math.max(
    0,
    maxScore - criticalPenalty - highPenalty - mediumPenalty,
  );

  const radialData = [
    {
      name: "background",
      value: 100,
      fill: "#f1f5f9", // slate-100
    },
    {
      name: "Integrity",
      value: integrityScore,
      fill:
        integrityScore > 80
          ? "#10b981"
          : integrityScore > 50
            ? "#f59e0b"
            : "#ef4444",
    },
  ];

  return (
    <div className="space-y-8 pb-10">
      {/* Header section with white/slate aesthetics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-widest text-content-3">
              Diagnostic Core
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-content-1">
            Inventory Health Matrix
          </h1>
          <p className="text-content-3 font-medium">
            Real-time systemic coherence engine and active structural warnings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={loadData}
            disabled={refreshing}
            className="shadow-sm border-line text-content-3 bg-surface-1 hover:bg-surface-2"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            Sync Layer
          </Button>
          <Button
            onClick={handleRunAudit}
            disabled={auditRunning}
            className="bg-surface-3 hover:bg-line text-white shadow-lg transition-all active:scale-95"
          >
            <ShieldCheck
              className={`h-4 w-4 mr-2 ${auditRunning ? "animate-pulse" : ""}`}
              strokeWidth={2}
            />
            Run Smart Audit
          </Button>
        </div>
      </div>

      {/* Metrics Array */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-content-3 flex items-center gap-2">
              <Package
                className="h-4 w-4 text-content-4 group-hover:text-primary transition-colors"
                strokeWidth={1.5}
              />
              Bulk Base Mass
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-content-1 tracking-tight">
              {safeHealth.bulk.total_kg.toLocaleString()}{" "}
              <span className="text-sm text-content-4 ml-1">kg</span>
            </div>
            <p className="text-xs font-semibold text-content-4 mt-2">
              {safeHealth.bulk.sku_count} Active SKUs
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-content-3 flex items-center gap-2">
              <CircleDot
                className="h-4 w-4 text-content-4 group-hover:text-primary transition-colors"
                strokeWidth={1.5}
              />
              WIP Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-content-1 tracking-tight">
              {safeHealth.rolls.available_kg.toLocaleString()}{" "}
              <span className="text-sm text-content-4 ml-1">kg</span>
            </div>
            <p className="text-xs font-semibold text-content-4 mt-2">
              {safeHealth.rolls.available_count} Free Rolls
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden group">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-content-3 flex items-center gap-2">
              <Boxes
                className="h-4 w-4 text-content-4 group-hover:text-success-fg transition-colors"
                strokeWidth={1.5}
              />
              Finished Goods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-content-1 tracking-tight flex items-baseline gap-2">
              {safeHealth.rolls.fg_kg.toLocaleString()}{" "}
              <span className="text-sm text-content-4">kg</span>
              <span className="flex h-1.5 w-1.5 rounded-full bg-success-fg"></span>
            </div>
            <p className="text-xs font-semibold text-content-4 mt-2">
              {safeHealth.rolls.fg_count} Final Output Spools
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden group border-b-4 border-b-warning-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-content-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-warning-fg" strokeWidth={1.5} />
              Locked Reserves
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-content-1 tracking-tight">
              {safeHealth.rolls.reserved_kg.toLocaleString()}{" "}
              <span className="text-sm text-content-4 ml-1">kg</span>
            </div>
            <p className="text-xs font-semibold text-warning-fg mt-2 bg-warning-bg inline-block px-2 py-0.5 rounded-sm">
              {safeHealth.rolls.reserved_count} Bound Rolls
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Radial Integrity Gauge */}
        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden flex flex-col items-center justify-center p-6 relative">
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-content-4" strokeWidth={1.5} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-content-4">
              System Integrity
            </span>
          </div>
          <div className="h-[240px] w-full mt-4 relative">
            <ScrollTriggeredChart className="w-full h-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  cx="50%"
                  cy="50%"
                  innerRadius="70%"
                  outerRadius="100%"
                  barSize={20}
                  data={radialData}
                  startAngle={180}
                  endAngle={0}
                >
                  <RadialBar background dataKey="value" cornerRadius={10} />
                </RadialBarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
            {/* Center Text absolute positioning over the generic HTML wrapper instead of SVG */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pb-4 pointer-events-none">
              <div className="text-5xl font-black tracking-tighter text-content-1">
                {integrityScore}%
              </div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-content-3 mt-1">
                Network State
              </div>
            </div>
          </div>
        </Card>

        {/* Alert Overview Columns */}
        <div className="lg:col-span-2 grid gap-4 lg:grid-cols-3">
          <Card className="border-0 bg-surface-1 shadow-md rounded-2xl p-6 flex flex-col justify-between border-t-4 border-t-rose-500">
            <div>
              <AlertTriangle
                className="h-6 w-6 text-danger-fg mb-4"
                strokeWidth={1.5}
              />
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-1">
                Critical Anomalies
              </p>
              <p className="text-4xl font-black tracking-tight text-content-1">
                {safeHealth.alerts.critical}
              </p>
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold text-danger-fg bg-danger-bg inline-block px-2 py-0.5 rounded-sm">
                Immediate Triage
              </p>
            </div>
          </Card>

          <Card className="border-0 bg-surface-1 shadow-md rounded-2xl p-6 flex flex-col justify-between border-t-4 border-t-orange-500">
            <div>
              <AlertTriangle
                className="h-6 w-6 text-warm mb-4"
                strokeWidth={1.5}
              />
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-1">
                High Priority
              </p>
              <p className="text-4xl font-black tracking-tight text-content-1">
                {safeHealth.alerts.high}
              </p>
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold text-warm bg-warm inline-block px-2 py-0.5 rounded-sm">
                Queue Escalation
              </p>
            </div>
          </Card>

          <Card className="border-0 bg-surface-1 shadow-md rounded-2xl p-6 flex flex-col justify-between border-t-4 border-t-emerald-500">
            <div>
              <CheckCircle2
                className={`h-6 w-6 ${safeHealth.alerts.total_open === 0 ? "text-success-fg" : "text-content-4"} mb-4`}
                strokeWidth={1.5}
              />
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-1">
                Total Outstanding
              </p>
              <p className="text-4xl font-black tracking-tight text-content-1">
                {safeHealth.alerts.total_open}
              </p>
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold text-content-3">
                Global Registry
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Alert List Rework */}
      <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="border-b border-line bg-surface-1 pb-6 pt-6 px-6">
          <CardTitle className="text-xl font-black text-content-1 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" strokeWidth={2.5} />
            Active Diagnostic Log
          </CardTitle>
          <CardDescription className="font-medium text-content-3">
            Sequential trace log of anomalies detected across multi-plant
            environments.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="text-center py-16 flex flex-col items-center justify-center">
              <div className="h-16 w-16 bg-success-bg rounded-full flex items-center justify-center mb-4">
                <ShieldCheck
                  className="h-8 w-8 text-success-fg"
                  strokeWidth={1.5}
                />
              </div>
              <p className="font-black text-lg text-content-1">
                Network 100% Validated
              </p>
              <p className="text-content-3 text-sm font-medium mt-1">
                Zero conflicts detected across global scope.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {alerts.map((alert) => {
                const isAccel =
                  alert.severity === "CRITICAL" || alert.severity === "HIGH";
                return (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between p-4 px-6 hover:bg-surface-2 transition-colors group"
                  >
                    <div className="flex items-start gap-4">
                      <Badge
                        variant="outline"
                        className={`mt-1 border-0 shadow-sm text-[10px] font-black uppercase tracking-widest ${isAccel ? "text-danger-fg bg-danger-bg" : "text-warning-fg bg-warning-bg"}`}
                      >
                        {alert.severity}
                      </Badge>
                      <div>
                        <p className="font-bold text-[14px] text-content-1">
                          {alert.type_display}
                        </p>
                        <p className="text-[13px] font-medium text-content-3 max-w-2xl mt-0.5">
                          {alert.message}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-3 min-w-32">
                      <span className="text-[11px] font-bold text-content-4 uppercase tracking-widest">
                        {new Date(alert.created_at).toLocaleDateString()}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-bold border-info-border text-primary bg-info-bg shadow-sm hover:bg-info-bg hidden group-hover:flex"
                        onClick={() => setResolvingId(alert.id)}
                      >
                        <CheckSquare
                          className="h-3 w-3 mr-1.5"
                          strokeWidth={2}
                        />{" "}
                        Resolve Event
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!resolvingId}
        onOpenChange={(open) => !open && setResolvingId(null)}
      >
        <DialogContent className="rounded-2xl border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">
              Resolve Anomaly Trace
            </DialogTitle>
            <DialogDescription className="font-medium text-content-3 pt-1">
              Acknowledge this database irregularity and lock it into the closed
              ledger. Please provide reasoning behind the trace closure.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Textarea
              placeholder="Resolution context matrix (e.g., Physical cycle count matching, API offset bypassed...)"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              className="bg-surface-2 border-line focus-visible:ring-primary min-h-[120px]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setResolvingId(null)}
              className="font-bold text-content-3"
            >
              Cancel
            </Button>
            <Button
              onClick={handleResolve}
              disabled={!resolveNote}
              className="bg-primary hover:bg-primary text-white font-bold shadow-md"
            >
              Mark Matrix Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
