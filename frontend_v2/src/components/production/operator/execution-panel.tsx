"use client";

import { useRouter } from "next/navigation";
import { Pause, Play, CheckCircle, ExternalLink, Factory } from "lucide-react";

import { OperatorJob, operatorService } from "@/services/operator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

interface ExecutionPanelProps {
  job: OperatorJob;
  onUpdate: () => void;
}

export function ExecutionPanel({ job, onUpdate }: ExecutionPanelProps) {
  const router = useRouter();
  const isExecuting = job.job_state === "EXECUTING";
  const isPaused = job.job_state === "PAUSED";
  const isReleased =
    job.job_state === "RELEASED" || job.job_state === "WAITING";

  const handleAction = async (
    action: () => Promise<any>,
    successTitle: string,
  ) => {
    try {
      await action();
      onUpdate();
      toast({
        title: successTitle,
        description: "Dashboard state refreshed.",
      });
    } catch (error: any) {
      toast({
        title: "Action Failed",
        description:
          error?.response?.data?.error ||
          error?.message ||
          "Could not update job state.",
        variant: "destructive",
      });
    }
  };

  const openMachineTerminal = () => {
    if (!job.machine?.id) {
      toast({
        title: "Machine not assigned",
        description:
          "Assign a machine first, then continue execution from the machine terminal.",
        variant: "destructive",
      });
      return;
    }
    router.push(`/production/machine/${job.machine.id}`);
  };

  return (
    <Card className="h-full shadow-sm flex flex-col">
      <CardHeader className="pb-4 border-b bg-surface-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Execution Handoff</CardTitle>
            <p className="mt-1 text-xs text-content-3 font-medium">
              Use the machine terminal for output, scrap, chemistry
              confirmation, and multi-roll logs.
            </p>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] font-black uppercase tracking-widest"
          >
            {job.job_state}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
              Machine
            </div>
            <div className="mt-2 text-sm font-bold text-content-1">
              {job.machine?.name || "Not Assigned"}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
              Work Center
            </div>
            <div className="mt-2 text-sm font-bold text-content-1">
              {job.work_center?.name || "Unassigned"}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
              Target
            </div>
            <div className="mt-2 text-sm font-bold text-content-1">
              {Number(job.quantity || 0).toFixed(3)} {job.uom}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
              Current Process
            </div>
            <div className="mt-2 text-sm font-bold text-content-1">
              {job.process_name || "Awaiting release"}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-info-border bg-info-bg p-4">
          <div className="flex items-start gap-3">
            <Factory className="h-5 w-5 mt-0.5 text-primary" />
            <div className="space-y-1">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-primary">
                Low-Click Operator Flow
              </div>
              <p className="text-sm text-primary font-medium leading-relaxed">
                During the run, the operator only logs output and scrap.
                Chemistry is confirmed at step close, and film remainder is
                auto-returned by the backend from reserved input rolls.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {isReleased && (
            <Button
              onClick={() =>
                handleAction(
                  () => operatorService.startJob(job.id),
                  "Job Started",
                )
              }
              className="bg-success-fg hover:bg-success-fg"
            >
              <Play className="w-4 h-4 mr-2" /> Start
            </Button>
          )}
          {isExecuting && (
            <Button
              variant="secondary"
              onClick={() =>
                handleAction(
                  () => operatorService.pauseJob(job.id, "Operator Pause"),
                  "Job Paused",
                )
              }
            >
              <Pause className="w-4 h-4 mr-2" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button
              onClick={() =>
                handleAction(
                  () => operatorService.resumeJob(job.id),
                  "Job Resumed",
                )
              }
              className="bg-success-fg hover:bg-success-fg"
            >
              <Play className="w-4 h-4 mr-2" /> Resume
            </Button>
          )}
          {(isExecuting || isPaused) && (
            <Button
              variant="outline"
              onClick={() =>
                handleAction(
                  () => operatorService.completeJob(job.id),
                  "Job Finalized",
                )
              }
            >
              <CheckCircle className="w-4 h-4 mr-2" /> Finalize
            </Button>
          )}
          <Button
            variant="outline"
            onClick={openMachineTerminal}
            className="sm:col-span-2"
          >
            <ExternalLink className="w-4 h-4 mr-2" /> Open Machine Terminal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
