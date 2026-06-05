"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Pause, CheckCircle2 } from "lucide-react";

interface JobItem {
  id: string;
  job_number: string;
  product: string;
  progress: number;
  status: "RUNNING" | "PAUSED" | "COMPLETED";
  operator?: string;
}

export function LiveJobFeed({ jobs = [] }: { jobs: JobItem[] }) {
  return (
    <Card className="border shadow-sm h-full">
      <CardHeader className="pb-3 border-b bg-surface-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wide text-content-3 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-success-fg animate-pulse" />
          Live Floor Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="divide-y divide-line">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="p-4 hover:bg-surface-2 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-content-2">
                      {job.job_number}
                    </span>
                    {job.status === "RUNNING" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-success-border text-success-fg bg-success-bg px-1 py-0 h-5"
                      >
                        RUNNING
                      </Badge>
                    )}
                    {job.status === "PAUSED" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-warning-border text-warning-fg bg-warning-bg px-1 py-0 h-5"
                      >
                        PAUSED
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs font-medium text-content-3 truncate max-w-[180px]">
                    {job.product}
                  </p>
                  <div className="mt-2 text-[10px] text-content-4 font-mono">
                    OP: {job.operator || "Unassigned"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold text-content-1">
                    {job.progress}%
                  </span>
                  <div className="w-16 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-1000"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {jobs.length === 0 && (
              <div className="p-8 text-center text-content-4 text-sm italic">
                No active jobs on the floor.
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
