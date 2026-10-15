"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { maintenanceService, type MaintenanceJob } from "@/services/maintenance";

import { JobRecord } from "./job-record";

/** Opens one job record in a dialog from any list. */
export function JobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const [job, setJob] = useState<MaintenanceJob | null>(null);
  const { data } = useQuery({
    queryKey: ["maintenance", "job", jobId],
    queryFn: () => maintenanceService.job(jobId as string),
    enabled: Boolean(jobId),
  });
  useEffect(() => {
    if (data) setJob(data);
  }, [data]);
  useEffect(() => {
    if (!jobId) setJob(null);
  }, [jobId]);
  return (
    <Dialog open={Boolean(jobId)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job ? job.title : "Maintenance job"}</DialogTitle>
          <DialogDescription>
            {job ? `${job.machine_detail?.code || ""} · ${job.machine_detail?.name || ""}${job.title_hi ? ` · ${job.title_hi}` : ""}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {job ? <JobRecord job={job} onChanged={setJob} /> : null}
      </DialogContent>
    </Dialog>
  );
}
