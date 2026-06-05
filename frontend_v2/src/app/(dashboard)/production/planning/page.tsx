"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { productionService, ProductionJob } from "@/services/production";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Play,
  Pause,
  Split,
  ArrowUpDown,
  Loader2,
  MoreHorizontal,
  ListFilter,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Hand,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function PlanningBoard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<ProductionJob | null>(null);
  const [splitQty, setSplitQty] = useState<string>("");
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState(false);
  const [isPriorityDialogOpen, setIsPriorityDialogOpen] = useState(false);
  const [newPriority, setNewPriority] = useState<number>(100);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["production-jobs-planning"],
    queryFn: () => productionService.getJobs(),
  });

  const mutation = useMutation({
    mutationFn: async (action: () => Promise<any>) => await action(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-jobs-planning"] });
      toast({
        title: "Action Successful",
        description: "The job has been updated successfully.",
      });
      setIsSplitDialogOpen(false);
      setIsPriorityDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Action Failed",
        description:
          error.response?.data?.error || "An unexpected error occurred.",
      });
    },
  });

  const handleRelease = (id: string) =>
    mutation.mutate(() => productionService.releaseJob(id));
  const handleToggleHold = (id: string) =>
    mutation.mutate(() => productionService.toggleHold(id));
  const handleSplit = () => {
    if (!selectedJob || !splitQty) return;
    mutation.mutate(() =>
      productionService.splitJob(selectedJob.id, parseFloat(splitQty)),
    );
  };
  const handleReprioritize = () => {
    if (!selectedJob) return;
    mutation.mutate(() =>
      productionService.reprioritizeJob(selectedJob.id, newPriority),
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // State-based filtering logic
  const pJobs = Array.isArray(jobs) ? jobs : [];
  const actionableJobs = pJobs.filter((j) => j.job_state !== "WAITING");

  const PLANNED = actionableJobs.filter((j) => j.job_state === "PLANNED");
  const RELEASED = actionableJobs.filter((j) => j.job_state === "RELEASED");
  const IN_PROGRESS = actionableJobs.filter(
    (j) => j.job_state === "EXECUTING" || j.job_state === "PAUSED",
  );
  const COMPLETED = actionableJobs.filter((j) => j.job_state === "COMPLETED");

  const getStateBadge = (state: string) => {
    switch (state) {
      case "PLANNED":
        return (
          <Badge
            variant="outline"
            className="bg-surface-2 uppercase text-[10px]"
          >
            Planned
          </Badge>
        );
      case "RELEASED":
        return (
          <Badge
            variant="secondary"
            className="bg-info-bg text-primary uppercase text-[10px] font-bold border-info-border"
          >
            Released
          </Badge>
        );
      case "EXECUTING":
        return (
          <Badge className="bg-success-fg uppercase text-[10px] font-black animate-pulse">
            Running
          </Badge>
        );
      case "PAUSED":
        return (
          <Badge variant="destructive" className="uppercase text-[10px]">
            Paused
          </Badge>
        );
      case "COMPLETED":
        return (
          <Badge className="bg-success-fg uppercase text-[10px] font-black">
            Completed
          </Badge>
        );
      case "WAITING":
        return (
          <Badge variant="outline" className="uppercase text-[10px] opacity-50">
            Waiting
          </Badge>
        );
      default:
        return <Badge variant="outline">{state}</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black tracking-tight text-content-1 uppercase">
          Production Planning Board
        </h1>
        <p className="text-sm text-muted-foreground font-medium">
          Manage job lifecycles and priorities agnostic of work centers.
        </p>
      </div>

      <Tabs defaultValue="planned" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="bg-surface-2 p-1">
            <TabsTrigger
              value="planned"
              className="uppercase text-[11px] font-bold gap-2"
            >
              Planned{" "}
              <Badge
                variant="outline"
                className="h-4 px-1 text-[9px] border-line-strong"
              >
                {PLANNED.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="released"
              className="uppercase text-[11px] font-bold gap-2"
            >
              Released{" "}
              <Badge
                variant="outline"
                className="h-4 px-1 text-[9px] border-line-strong"
              >
                {RELEASED.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="in-progress"
              className="uppercase text-[11px] font-bold gap-2"
            >
              In Progress{" "}
              <Badge
                variant="outline"
                className="h-4 px-1 text-[9px] border-line-strong"
              >
                {IN_PROGRESS.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="completed"
              className="uppercase text-[11px] font-bold gap-2"
            >
              Completed{" "}
              <Badge
                variant="outline"
                className="h-4 px-1 text-[9px] border-line-strong"
              >
                {COMPLETED.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["production-jobs-planning"],
                })
              }
            >
              <Clock className="w-4 h-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        <TabsContent value="planned">
          <JobTable jobs={PLANNED} />
        </TabsContent>
        <TabsContent value="released">
          <JobTable jobs={RELEASED} />
        </TabsContent>
        <TabsContent value="in-progress">
          <JobTable jobs={IN_PROGRESS} />
        </TabsContent>
        <TabsContent value="completed">
          <JobTable jobs={COMPLETED} />
        </TabsContent>
      </Tabs>

      {/* Split Dialog */}
      <Dialog open={isSplitDialogOpen} onOpenChange={setIsSplitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="uppercase font-black tracking-tighter">
              Split Job: {selectedJob?.job_number}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg border">
              <Label className="text-[11px] font-bold uppercase text-content-3">
                Current Quantity
              </Label>
              <p className="text-lg font-black">
                {selectedJob?.quantity} {selectedJob?.uom}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="uppercase font-bold text-[11px]">
                New Job Quantity (Split Off)
              </Label>
              <Input
                type="number"
                placeholder="Enter split quantity..."
                value={splitQty}
                onChange={(e) => setSplitQty(e.target.value)}
                className="font-bold h-12 text-lg"
              />
              <p className="text-[10px] text-muted-foreground italic mt-1 leading-tight">
                Remaining quantity (
                {selectedJob
                  ? selectedJob.quantity - (parseFloat(splitQty) || 0)
                  : 0}{" "}
                {selectedJob?.uom}) will stay on the original job.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSplitDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-primary hover:bg-primary"
              onClick={handleSplit}
              disabled={mutation.isPending}
            >
              {mutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Confirm Split
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Priority Dialog */}
      <Dialog
        open={isPriorityDialogOpen}
        onOpenChange={setIsPriorityDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="uppercase font-black tracking-tighter">
              Adjust Priority: {selectedJob?.job_number}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label className="uppercase font-bold text-[11px]">
                Numeric Priority (Lower is Higher)
              </Label>
              <Input
                type="number"
                value={newPriority}
                onChange={(e) => setNewPriority(parseInt(e.target.value))}
                className="font-bold h-12 text-lg"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPriorityDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-surface-3"
              onClick={handleReprioritize}
              disabled={mutation.isPending}
            >
              Save Priority
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function JobTable({ jobs }: { jobs: ProductionJob[] }) {
    return (
      <Card className="border-line shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-surface-2">
            <TableRow>
              <TableHead className="uppercase text-[10px] font-black w-[150px]">
                Job ID
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black">
                Product / Template
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black">
                Quantity
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black">
                Process
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black">
                Priority
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black">
                State
              </TableHead>
              <TableHead className="uppercase text-[10px] font-black text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                className="group hover:bg-info-bg transition-colors"
              >
                <TableCell className="py-4">
                  <div className="font-bold text-content-1">
                    {job.job_number}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    SO: {job.order_number || "N/A"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-content-2">
                    {job.product_name}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                    {job.customer_name}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-black text-content-2">
                    {job.quantity} {job.uom}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold border-line-strong bg-surface-1"
                  >
                    {job.process_code}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 font-mono text-xs hover:bg-line"
                    onClick={() => {
                      setSelectedJob(job);
                      setNewPriority(job.priority);
                      setIsPriorityDialogOpen(true);
                    }}
                  >
                    #{job.priority}{" "}
                    <ArrowUpDown className="w-3 h-3 ml-2 opacity-30" />
                  </Button>
                </TableCell>
                <TableCell>{getStateBadge(job.job_state)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {job.job_state === "PLANNED" && (
                      <>
                        <Button
                          size="sm"
                          className="h-8 bg-primary hover:bg-primary"
                          onClick={() => handleRelease(job.id)}
                        >
                          Release
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => {
                            setSelectedJob(job);
                            setIsSplitDialogOpen(true);
                          }}
                        >
                          <Split className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    {job.job_state === "RELEASED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-line-strong text-content-3 hover:bg-surface-2"
                        onClick={() => handleToggleHold(job.id)}
                      >
                        <Pause className="w-3.5 h-3.5 mr-1" /> Hold
                      </Button>
                    )}
                    {job.job_state === "PAUSED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-success-border text-success-fg hover:bg-success-bg"
                        onClick={() =>
                          mutation.mutate(() =>
                            productionService.resumeJob(job.id),
                          )
                        }
                      >
                        <Play className="w-3.5 h-3.5 mr-1" /> Resume
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            mutation.mutate(() =>
                              productionService.sendToJobWork(job.id),
                            )
                          }
                        >
                          Detour to Job Work
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          Cancel Job
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }
}
