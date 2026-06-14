"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  factoryService,
  type Plant,
  type PlantShiftDefinition,
  type PlantShiftPayload,
} from "@/services/factory";

type ShiftDraft = {
  plant: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  is_active: boolean;
  priority: string;
};

const blankDraft = (plant = ""): ShiftDraft => ({
  plant,
  code: "",
  name: "",
  start_time: "08:00",
  end_time: "16:00",
  crosses_midnight: false,
  is_active: true,
  priority: "100",
});

const toInputTime = (value?: string) => String(value || "").slice(0, 5);

const durationLabel = (start?: string, end?: string, crossesMidnight = false) => {
  const [startH, startM] = toInputTime(start).split(":").map(Number);
  const [endH, endM] = toInputTime(end).split(":").map(Number);
  if ([startH, startM, endH, endM].some((value) => Number.isNaN(value))) return "-";
  const startMin = startH * 60 + startM;
  let endMin = endH * 60 + endM;
  if (crossesMidnight || endMin <= startMin) endMin += 24 * 60;
  const total = Math.max(0, endMin - startMin);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

function payloadFromDraft(draft: ShiftDraft): PlantShiftPayload {
  return {
    plant: draft.plant,
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    start_time: draft.start_time,
    end_time: draft.end_time,
    crosses_midnight: draft.crosses_midnight,
    is_active: draft.is_active,
    priority: Number(draft.priority || 100),
  };
}

export default function ShiftTimingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [plantId, setPlantId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShiftDraft>(blankDraft());

  const plantsQuery = useQuery({
    queryKey: ["shift-timing-plants"],
    queryFn: factoryService.getPlants,
    staleTime: 60_000,
  });
  const plants = plantsQuery.data || [];

  useEffect(() => {
    if (!plantId && plants.length) {
      setPlantId(plants[0].id);
      setDraft((current) => ({ ...current, plant: plants[0].id }));
    }
  }, [plantId, plants]);

  const shiftsQuery = useQuery({
    queryKey: ["shift-definitions", plantId],
    queryFn: () => factoryService.getShiftDefinitions(plantId),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });
  const shifts = useMemo(
    () =>
      [...(shiftsQuery.data || [])].sort(
        (a, b) => Number(a.priority || 0) - Number(b.priority || 0) || a.code.localeCompare(b.code),
      ),
    [shiftsQuery.data],
  );
  const selectedPlant = plants.find((plant: Plant) => plant.id === plantId);

  const saveMutation = useMutation({
    mutationFn: (payload: PlantShiftPayload) =>
      editingId
        ? factoryService.updateShiftDefinition(editingId, payload)
        : factoryService.createShiftDefinition(payload),
    onSuccess: () => {
      toast({ title: editingId ? "Shift updated" : "Shift created" });
      setEditingId(null);
      setDraft(blankDraft(plantId));
      queryClient.invalidateQueries({ queryKey: ["shift-definitions"] });
      queryClient.invalidateQueries({ queryKey: ["production-current-shift"] });
    },
    onError: (error: any) =>
      toast({
        title: "Shift save failed",
        description:
          error?.response?.data?.detail ||
          error?.response?.data?.error ||
          error?.message ||
          "Request failed.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: factoryService.deleteShiftDefinition,
    onSuccess: () => {
      toast({ title: "Shift deleted" });
      queryClient.invalidateQueries({ queryKey: ["shift-definitions"] });
    },
    onError: (error: any) =>
      toast({
        title: "Delete failed",
        description:
          error?.response?.data?.detail ||
          error?.response?.data?.error ||
          error?.message ||
          "Request failed.",
        variant: "destructive",
      }),
  });

  const selectPlant = (nextPlantId: string) => {
    setPlantId(nextPlantId);
    setEditingId(null);
    setDraft(blankDraft(nextPlantId));
  };

  const editShift = (shift: PlantShiftDefinition) => {
    setEditingId(shift.id);
    setDraft({
      plant: shift.plant,
      code: shift.code,
      name: shift.name || "",
      start_time: toInputTime(shift.start_time),
      end_time: toInputTime(shift.end_time),
      crosses_midnight: Boolean(shift.crosses_midnight),
      is_active: Boolean(shift.is_active),
      priority: String(shift.priority ?? 100),
    });
  };

  const canSave =
    Boolean(draft.plant) &&
    Boolean(draft.code.trim()) &&
    Boolean(draft.start_time) &&
    Boolean(draft.end_time) &&
    !saveMutation.isPending;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6" data-testid="shift-timing-page">
      <section className="rounded-[22px] border border-line bg-surface-1 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
              <Clock3 className="h-3.5 w-3.5" />
              Admin · Shift Timing
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-content-1">
              Fixed shift windows
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-content-3">
              Issue, return, count, WCM, and machine logs resolve shift from the event timestamp. Operators do not manually pick shifts.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-1.5">
            <Label>Plant</Label>
            <select
              value={plantId}
              onChange={(event) => selectPlant(event.target.value)}
              className="h-11 rounded-xl border border-line bg-surface-1 px-3 text-sm font-bold text-content-1"
            >
              {plants.map((plant: Plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.code} · {plant.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
        <section className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-content-1">
                {editingId ? "Edit shift" : "Add shift"}
              </h2>
              <p className="text-xs font-semibold text-content-3">
                {selectedPlant ? `${selectedPlant.code} · ${selectedPlant.name}` : "Select a plant first"}
              </p>
            </div>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setDraft(blankDraft(plantId));
                }}
              >
                New
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Code</Label>
                <Input
                  value={draft.code}
                  onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                  placeholder="A"
                  className="font-black uppercase"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Morning"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Start time</Label>
                <Input
                  type="time"
                  value={draft.start_time}
                  onChange={(event) => {
                    const nextStart = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      start_time: nextStart,
                      crosses_midnight: current.end_time <= nextStart,
                    }));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>End time</Label>
                <Input
                  type="time"
                  value={draft.end_time}
                  onChange={(event) => {
                    const nextEnd = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      end_time: nextEnd,
                      crosses_midnight: nextEnd <= current.start_time,
                    }));
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
                <span>
                  <span className="block text-sm font-black text-content-1">Crosses midnight</span>
                  <span className="block text-xs font-semibold text-content-3">
                    {durationLabel(draft.start_time, draft.end_time, draft.crosses_midnight)}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.crosses_midnight}
                  onChange={(event) => setDraft((current) => ({ ...current, crosses_midnight: event.target.checked }))}
                  className="h-5 w-5"
                />
              </label>
              <div className="grid gap-1.5">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={draft.priority}
                  onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}
                />
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <span>
                <span className="block text-sm font-black text-content-1">Active</span>
                <span className="block text-xs font-semibold text-content-3">
                  Inactive shifts stay stored but are not used for new timestamp inference.
                </span>
              </span>
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                className="h-5 w-5"
              />
            </label>

            <Button
              data-testid="shift-timing-save"
              disabled={!canSave}
              onClick={() => saveMutation.mutate(payloadFromDraft(draft))}
              className="h-11 rounded-xl"
            >
              {editingId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              {saveMutation.isPending ? "Saving..." : editingId ? "Save shift" : "Add shift"}
            </Button>
          </div>
        </section>

        <section className="rounded-[18px] border border-line bg-surface-1 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-content-1">Plant shift definitions</h2>
              <p className="text-xs font-semibold text-content-3">
                {shifts.length} configured window{shifts.length === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => shiftsQuery.refetch()}
              disabled={shiftsQuery.isFetching}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">
                <tr>
                  <th className="px-5 py-3">Shift</th>
                  <th className="px-5 py-3">Window</th>
                  <th className="px-5 py-3">Priority</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shifts.length ? (
                  shifts.map((shift) => (
                    <tr key={shift.id} className={editingId === shift.id ? "bg-order-bg/40" : ""}>
                      <td className="px-5 py-4">
                        <div className="font-black text-content-1">{shift.code}</div>
                        <div className="text-xs font-semibold text-content-3">{shift.name || "Shift"}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-content-1">
                          {toInputTime(shift.start_time)} - {toInputTime(shift.end_time)}
                        </div>
                        <div className="text-xs font-semibold text-content-3">
                          {durationLabel(shift.start_time, shift.end_time, shift.crosses_midnight)}
                          {shift.crosses_midnight ? " · crosses midnight" : ""}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-bold text-content-2">{shift.priority}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-black ${
                            shift.is_active
                              ? "border-success-border bg-success-bg text-success-fg"
                              : "border-line bg-surface-2 text-content-3"
                          }`}
                        >
                          {shift.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => editShift(shift)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete shift ${shift.code}?`)) {
                                deleteMutation.mutate(shift.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm font-semibold text-content-3">
                      No shifts configured for this plant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
