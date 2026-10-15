"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PausePayload = {
  reason: string;
  reason_bucket: string;
  reason_code_id: string | null;
};

type ReasonCode = {
  id: string;
  code: string;
  label: string;
  parent_id?: string | null;
  parent_code?: string | null;
  is_active?: boolean;
};

/** Downtime buckets the OEE report understands; the reason master hangs under them. */
export const PAUSE_BUCKETS: Array<{ code: string; label: string; hindi: string }> = [
  { code: "BREAKDOWN", label: "Machine breakdown", hindi: "मशीन खराब" },
  { code: "MAINTENANCE", label: "Maintenance", hindi: "रखरखाव" },
  { code: "MATERIAL", label: "Material shortage", hindi: "माल नहीं" },
  { code: "MANPOWER", label: "Manpower shortage", hindi: "स्टाफ नहीं" },
  { code: "POWER", label: "Power failure", hindi: "बिजली गई" },
  { code: "OTHER", label: "Other", hindi: "अन्य" },
];

function bucketOf(code: ReasonCode, all: ReasonCode[]): string {
  let current: ReasonCode | undefined = code;
  let guard = 0;
  while (current && current.parent_id && guard < 5) {
    current = all.find((row) => String(row.id) === String(current?.parent_id));
    guard += 1;
  }
  const root = String(current?.code || "").toUpperCase();
  return PAUSE_BUCKETS.some((b) => b.code === root) ? root : "";
}

/**
 * One pause dialog for every terminal: a reason bucket (mandatory), an optional
 * governed reason code from the downtime master, and a short note. The backend
 * writes a downtime record from it, so pause time reaches OEE and maintenance.
 */
export function PauseReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  pending = false,
  title = "Pause · रोकें",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: PausePayload) => void | Promise<void>;
  pending?: boolean;
  title?: string;
}) {
  const [bucket, setBucket] = useState("");
  const [codeId, setCodeId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data: codes = [] } = useQuery({
    queryKey: ["downtime-reasons"],
    queryFn: async () => {
      const { data } = await api.get("/api/production/downtime-reasons/", { params: { page_size: 200 } });
      const rows = Array.isArray(data) ? data : data?.results || data?.data || [];
      return (rows as ReasonCode[]).filter((row) => row.is_active !== false);
    },
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const codesForBucket = useMemo(
    () => (bucket ? codes.filter((row) => row.parent_id && bucketOf(row, codes) === bucket) : []),
    [bucket, codes],
  );

  useEffect(() => {
    if (!open) {
      setBucket("");
      setCodeId(null);
      setNote("");
    }
  }, [open]);

  const canConfirm = Boolean(bucket) && (bucket !== "OTHER" || note.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Why is the machine stopping? The time is recorded as downtime with this reason. · मशीन क्यों रुक रही है?
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pause reason">
          {PAUSE_BUCKETS.map((row) => (
            <button
              key={row.code}
              type="button"
              role="radio"
              aria-checked={bucket === row.code}
              onClick={() => {
                setBucket(row.code);
                setCodeId(null);
              }}
              className={cn(
                "rounded-xl border-2 px-3 py-3 text-left text-sm font-semibold leading-tight transition",
                bucket === row.code
                  ? "border-primary bg-info-bg text-content-1"
                  : "border-line bg-surface-1 text-content-2 hover:border-primary",
              )}
            >
              <span className="block">{row.label}</span>
              <span className="block text-caption font-medium text-content-3">{row.hindi}</span>
            </button>
          ))}
        </div>
        {codesForBucket.length ? (
          <div>
            <div className="mb-1 text-caption font-semibold uppercase tracking-[0.08em] text-content-3">Reason code (optional)</div>
            <div className="flex flex-wrap gap-1.5">
              {codesForBucket.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={codeId === row.id}
                  onClick={() => setCodeId(codeId === row.id ? null : row.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-caption font-semibold",
                    codeId === row.id ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-2 text-content-2",
                  )}
                >
                  {row.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <label htmlFor="pause-note" className="mb-1 block text-caption font-semibold uppercase tracking-[0.08em] text-content-3">
            Note {bucket === "OTHER" ? "(required for Other)" : "(optional)"} · टिप्पणी
          </label>
          <Textarea
            id="pause-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="What happened? · क्या हुआ?"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm || pending}
            onClick={() => onConfirm({ reason: note.trim(), reason_bucket: bucket, reason_code_id: codeId })}
          >
            {pending ? "Pausing…" : "Pause machine · रोकें"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
