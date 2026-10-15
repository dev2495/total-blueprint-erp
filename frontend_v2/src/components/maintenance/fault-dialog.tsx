"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService, type MachineFault, type Severity } from "@/services/maintenance";

/** Report a fault from any screen. When `machineId` is given the machine is fixed. */
export function FaultDialog({
  open,
  onOpenChange,
  machineId,
  machineLabel,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineId?: string;
  machineLabel?: string;
  onReported?: (fault: MachineFault) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [machine, setMachine] = useState(machineId || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (open) {
      setMachine(machineId || "");
      setTitle("");
      setDescription("");
      setSeverity("MEDIUM");
      setStopped(false);
    }
  }, [open, machineId]);

  const { data: machines = [] } = useQuery({
    queryKey: ["factory-machines-all"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/machines/", { params: { page_size: 500 } });
      const rows = Array.isArray(data) ? data : data?.results || data?.data || [];
      return rows as Array<{ id: string; code: string; name: string; work_center_name?: string }>;
    },
    enabled: open && !machineId,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: () => maintenanceService.reportFault({ machine, title: title.trim(), description: description.trim(), severity, machine_running: !stopped }),
    onSuccess: (fault) => {
      toast({ title: "Fault reported · खराबी दर्ज", description: stopped ? "The running step was paused as a breakdown." : undefined });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      onReported?.(fault);
      onOpenChange(false);
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not report", description: describeApiError(err) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a fault · खराबी बताएँ</DialogTitle>
          <DialogDescription>{machineLabel ? `Machine ${machineLabel}` : "Say which machine and what is wrong. Maintenance is notified at once."}</DialogDescription>
        </DialogHeader>
        {!machineId ? (
          <Select value={machine} onValueChange={setMachine}>
            <SelectTrigger aria-label="Machine" data-testid="fault-machine">
              <SelectValue placeholder="Machine · मशीन" />
            </SelectTrigger>
            <SelectContent>
              {machines.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.code} · {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is wrong? · क्या खराबी है?" aria-label="Fault title" className="h-12 text-base" data-testid="fault-title" />
        <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Details, sounds, where you saw it (optional)" aria-label="Fault description" />
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Severity">
          {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((level) => (
            <button key={level} type="button" role="radio" aria-checked={severity === level} onClick={() => setSeverity(level)} className={cn("rounded-lg border px-2 py-2 text-caption font-bold", severity === level ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2")}>
              {level}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-danger-border bg-danger-bg/40 px-3 py-3 text-sm font-semibold text-content-1">
          <input type="checkbox" checked={stopped} onChange={(event) => setStopped(event.target.checked)} data-testid="fault-stopped" />
          Machine has stopped · मशीन बंद है
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="button" disabled={!machine || !title.trim() || mutation.isPending} onClick={() => mutation.mutate()} data-testid="fault-submit">
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Report · दर्ज करें
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
