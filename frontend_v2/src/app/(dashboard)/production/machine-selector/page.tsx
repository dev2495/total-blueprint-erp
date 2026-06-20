"use client";

/**
 * Machine Selector Page
 *
 * Shown when a Work Center Manager has multiple machines under assigned work centers.
 * Each card shows: machine name, status, current job, queue count.
 * Click navigates to /production/machine/[machine_id]
 */
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Server,
  Play,
  Pause,
  AlertCircle,
  ChevronRight,
  Package,
  Layers,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { machineService } from "@/services/machine";

export default function MachineSelectorPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [workCenterFilter, setWorkCenterFilter] = useState("ALL");
  const [plantFilter, setPlantFilter] = useState("ALL");
  const [lastMachineId, setLastMachineId] = useState("");
  const storageKey = "tbp:last_machine_terminal";

  const {
    data: machinesData = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["wcm-machines"],
    queryFn: () => machineService.getOperatorMachines(),
    staleTime: 30_000,
    refetchInterval: 45_000,
    retry: 1,
  });
  const machines = Array.isArray(machinesData) ? machinesData : [];
  const workCenterOptions = useMemo(
    () =>
      Array.from(
        new Set(machines.map((machine) => machine.work_center_name).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [machines],
  );
  const plantOptions = useMemo(
    () =>
      Array.from(
        new Set(machines.map((machine) => machine.plant_name).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [machines],
  );
  const machineStats = useMemo(
    () => ({
      active: machines.filter((machine) => machine.status === "ACTIVE").length,
      running: machines.filter((machine) => Boolean(machine.current_job))
        .length,
      queued: machines.reduce(
        (total, machine) => total + Number(machine.queue_count || 0),
        0,
      ),
      workCenters: workCenterOptions.length,
    }),
    [machines, workCenterOptions.length],
  );
  const filteredMachines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return machines.filter((machine) => {
      const machineStatus = String(machine.status || "").toUpperCase();
      if (statusFilter === "ACTIVE" && machineStatus !== "ACTIVE") return false;
      if (statusFilter === "RUNNING" && !machine.current_job) return false;
      if (statusFilter === "IDLE" && machine.current_job) return false;
      if (
        workCenterFilter !== "ALL" &&
        String(machine.work_center_name || "") !== workCenterFilter
      )
        return false;
      if (plantFilter !== "ALL" && String(machine.plant_name || "") !== plantFilter)
        return false;
      if (!q) return true;
      return (
        String(machine.name || "")
          .toLowerCase()
          .includes(q) ||
        String(machine.code || "")
          .toLowerCase()
          .includes(q) ||
        String(machine.work_center_name || "")
          .toLowerCase()
          .includes(q) ||
        String(machine.plant_name || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [machines, plantFilter, query, statusFilter, workCenterFilter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const remembered = window.localStorage.getItem(storageKey) || "";
    setLastMachineId(remembered);
  }, []);

  useEffect(() => {
    if (machines.length === 1) {
      const target = String(machines[0].id);
      if (typeof window !== "undefined")
        window.localStorage.setItem(storageKey, target);
      router.replace(`/production/machine/${target}`);
    }
  }, [machines, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-2 to-surface-2 flex items-center justify-center">
        <div className="text-lg text-content-3">Loading machines...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-2 to-surface-2 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-danger-fg" />
          <h2 className="text-xl font-semibold text-content-2 mb-2">
            Failed to load machines
          </h2>
          <p className="text-content-3">Please try again or contact support</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (machines.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-2 to-surface-2 flex items-center justify-center">
        <div className="text-center">
          <Server className="w-16 h-16 mx-auto mb-4 text-content-4" />
          <h2 className="text-xl font-semibold text-content-2 mb-2">
            No Machines Assigned
          </h2>
          <p className="text-content-3">
            Assign a work center to this manager to unlock its machines.
          </p>
        </div>
      </div>
    );
  }

  // If only one machine, auto-redirect handled in effect.
  if (machines.length === 1) return null;

  return (
    <div
      className="min-h-screen bg-surface-2 text-content-1"
      data-testid="machine-selector-page"
    >
      <div className="mx-auto max-w-[1600px] px-5 py-6 lg:px-8">
        <section className="rounded-lg border border-line bg-surface-1 p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.75)]">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                Production floor terminal
              </div>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-content-1">
                Machine Selector
              </h1>
              <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-content-3">
                Choose an assigned machine, inspect queue load, and enter the
                terminal for live production logging.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ["Active", machineStats.active, "text-success-fg"],
                ["Running", machineStats.running, "text-primary"],
                ["Queued jobs", machineStats.queued, "text-warning-fg"],
                ["Work centers", machineStats.workCenters, "text-content-1"],
              ].map(([label, value, tone]) => (
                <div
                  key={String(label)}
                  className="min-w-[120px] rounded-lg border border-line bg-surface-2 px-3 py-2"
                >
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3">
                    {label}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-xl font-black tabular-nums",
                      String(tone),
                    )}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-2 lg:grid-cols-[minmax(280px,1.6fr)_170px_220px_190px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 rounded-lg border-line bg-surface-2 pl-9 text-sm font-semibold"
                placeholder="Search machine, code, work center, or plant..."
                data-testid="machine-selector-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 rounded-lg border-line bg-surface-2 text-sm font-semibold">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All states</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="RUNNING">Running job</SelectItem>
                <SelectItem value="IDLE">Idle</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={workCenterFilter}
              onValueChange={setWorkCenterFilter}
            >
              <SelectTrigger className="h-10 rounded-lg border-line bg-surface-2 text-sm font-semibold">
                <SelectValue placeholder="Work center" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All work centers</SelectItem>
                {workCenterOptions.map((workCenter) => (
                  <SelectItem key={workCenter} value={workCenter}>
                    {workCenter}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={plantFilter} onValueChange={setPlantFilter}>
              <SelectTrigger className="h-10 rounded-lg border-line bg-surface-2 text-sm font-semibold">
                <SelectValue placeholder="Plant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All plants</SelectItem>
                {plantOptions.map((plant) => (
                  <SelectItem key={plant} value={plant}>
                    {plant}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg bg-surface-1 px-4 text-sm font-bold"
              onClick={() => {
                setQuery("");
                setStatusFilter("ALL");
                setWorkCenterFilter("ALL");
                setPlantFilter("ALL");
              }}
            >
              Clear
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-content-3">
            <span>{filteredMachines.length} visible</span>
            {lastMachineId ? <span>Last used terminal highlighted</span> : null}
          </div>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredMachines.map((machine, idx) => {
            const isActive = machine.status === "ACTIVE";
            const isExecuting = Boolean(machine.current_job);
            const isLastUsed = String(machine.id) === String(lastMachineId);

            return (
              <div
                key={machine.id}
                className="group relative animate-in fade-in zoom-in-95 duration-500"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <Card
                  className={cn(
                    "relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-line bg-surface-1 transition hover:border-info-border hover:shadow-[0_18px_42px_-34px_rgba(59,130,246,0.7)]",
                    isLastUsed
                      ? "border-success-border ring-1 ring-success-border"
                      : "",
                  )}
                  data-testid={`machine-card-${machine.id}`}
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(
                        storageKey,
                        String(machine.id),
                      );
                    }
                    router.push(`/production/machine/${machine.id}`);
                  }}
                >
                  <div
                    className={cn(
                      "h-1 w-full",
                      isLastUsed
                        ? "bg-success-fg"
                        : isActive
                          ? "bg-primary"
                          : "bg-line",
                    )}
                  />

                  <CardHeader className="pb-3 pt-5">
                    <div className="flex items-start justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border",
                            isActive
                              ? "border-info-border bg-info-bg text-primary"
                              : "border-line bg-surface-2 text-content-4",
                          )}
                        >
                          <Server className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-black tracking-tight text-content-1 transition-colors group-hover:text-primary">
                            {machine.name}
                          </h3>
                          <p className="text-xs font-bold uppercase tracking-wider text-content-4">
                            UID: {machine.code}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {isLastUsed ? (
                          <Badge className="rounded-full bg-success-fg px-2 py-0.5 text-[10px] font-bold">
                            Last Used
                          </Badge>
                        ) : null}
                        <Badge
                          variant={isActive ? "default" : "secondary"}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[10px] font-bold shadow-sm",
                            isActive
                              ? "bg-success-bg text-success-fg border-success-border"
                              : "bg-surface-2 text-content-3 border-line",
                          )}
                        >
                          {isActive && (
                            <div className="w-1.5 h-1.5 rounded-full bg-success-fg mr-1.5 animate-pulse" />
                          )}
                          {machine.status}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col gap-4 px-5 pb-5">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-content-3">
                      <Package className="h-3.5 w-3.5 text-content-4" />
                      <span>{machine.work_center_name}</span>
                      <span className="mx-0.5 text-content-4">|</span>
                      <span>{machine.plant_name}</span>
                    </div>

                    <div className="min-h-[96px]">
                      {isExecuting ? (
                        <div className="rounded-lg border border-info-border bg-info-bg p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <div className="relative">
                              <div className="absolute inset-0 animate-ping rounded-full bg-info-fg opacity-20"></div>
                              <Play className="relative h-3.5 w-3.5 text-primary" />
                            </div>
                            <span className="text-[10px] font-black text-primary uppercase tracking-widest">
                              Active Execution
                            </span>
                          </div>
                          <p className="text-sm font-black text-content-2 line-clamp-1 mb-1">
                            {machine.current_job?.job_number}
                          </p>
                          <p className="text-[11px] font-medium text-content-3 line-clamp-1">
                            {machine.current_job?.product_name}
                          </p>
                        </div>
                      ) : (
                        <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface-2 p-4 text-center">
                          <Pause className="mb-2 h-5 w-5 text-content-4" />
                          <p className="text-[11px] font-bold text-content-4 uppercase tracking-widest leading-none">
                            Idle Terminal
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-1">
                          <Layers className="h-4 w-4 text-content-4" />
                        </div>
                        <span className="text-xs font-bold text-content-3 uppercase tracking-tight">
                          Pending Jobs
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-content-1 leading-none">
                          {machine.queue_count}
                        </span>
                        <div className="px-1.5 py-0.5 rounded bg-info-bg text-primary text-[10px] font-black uppercase">
                          Queue
                        </div>
                      </div>
                    </div>

                    <Button className="mt-auto h-10 w-full rounded-lg border-none bg-surface-3 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition hover:bg-primary">
                      Enter Terminal
                      <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </section>

        {!filteredMachines.length ? (
          <div className="mt-5 rounded-lg border border-dashed border-line-strong bg-surface-1 p-8 text-center text-sm font-semibold text-content-3">
            No machine matched the current search query.
          </div>
        ) : null}
      </div>
    </div>
  );
}
