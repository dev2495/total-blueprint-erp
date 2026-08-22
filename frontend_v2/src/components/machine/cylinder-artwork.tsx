"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type CylinderAssignment = {
  id: string;
  side: "FRONT" | "BACK" | string;
  side_slot_index: number;
  color_name: string;
  cylinder_code?: string | null;
  cylinder_name?: string | null;
  cylinder_location_name?: string | null;
  cylinder?: string | null;
};

type ArtworkImagePayload = {
  id: string;
  image: string;
  sort_order: number;
};

type ArtworkPayload = {
  id: string;
  design_code: string;
  name: string;
  images?: ArtworkImagePayload[];
  image?: string | null;
};

interface CylinderSetCardProps {
  artworkId?: string | null;
  artworkCode?: string | null;
  artworkName?: string | null;
  printCapable: boolean;
}

export function CylinderSetCard({
  artworkId,
  artworkCode,
  artworkName,
  printCapable,
}: CylinderSetCardProps) {
  const enabled = Boolean(artworkId) && printCapable;
  const { data, isLoading } = useQuery({
    queryKey: ["cylinder-slot-assignments", artworkId],
    queryFn: async () => {
      const { data } = await api.get(
        `/api/tooling/cylinder-slot-assignments/`,
        {
          params: { artwork: artworkId },
        },
      );
      const list: CylinderAssignment[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.results)
          ? (data as any).results
          : [];
      return list;
    },
    enabled,
    staleTime: 30 * 1000,
  });

  if (!printCapable) return null;

  const assignments = Array.isArray(data) ? data : [];
  const sortedFront = assignments
    .filter((a) => String(a.side || "").toUpperCase() === "FRONT")
    .sort(
      (a, b) => Number(a.side_slot_index || 0) - Number(b.side_slot_index || 0),
    );
  const sortedBack = assignments
    .filter((a) => String(a.side || "").toUpperCase() === "BACK")
    .sort(
      (a, b) => Number(a.side_slot_index || 0) - Number(b.side_slot_index || 0),
    );

  return (
    <section
      className="mb-4 rounded-2xl border border-line bg-surface-1 p-4 shadow-sm"
      data-testid="machine-cylinder-set-card"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-order-fg" />
          <div className="text-[11px] font-bold uppercase tracking-wider text-content-3">
            Cylinder set
          </div>
          {artworkCode ? (
            <Badge
              variant="outline"
              className="border-order-border bg-order-bg text-[10px] font-semibold text-order-fg"
            >
              {artworkCode}
            </Badge>
          ) : null}
          {artworkName ? (
            <span className="text-[11px] text-content-3">{artworkName}</span>
          ) : null}
        </div>
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-content-4" />
        ) : null}
      </div>

      {!artworkId ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-2 p-3 text-[11px] text-content-3">
          No artwork committed for this job — no cylinder set to mount.
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-warning-border bg-warning-bg p-3 text-[11px] text-warning-fg">
          No cylinder slot assignments found for this artwork. Engineering must
          finalize cylinders before printing.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <SidePanel title="Front" assignments={sortedFront} />
          {sortedBack.length > 0 ? (
            <SidePanel title="Back" assignments={sortedBack} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function SidePanel({
  title,
  assignments,
}: {
  title: string;
  assignments: CylinderAssignment[];
}) {
  if (assignments.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-2">
      <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-content-3">
        {title}
      </div>
      <div className="space-y-1">
        {assignments.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5"
          >
            <span className="font-mono text-[10px] font-bold text-content-3">
              {String(a.side).slice(0, 1)}-{a.side_slot_index}
            </span>
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-border">
              {a.color_name || "—"}
            </span>
            <span className="font-mono text-[11px] font-semibold text-content-2">
              {a.cylinder_code || "—"}
            </span>
            <span className="ml-auto rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-content-3">
              {a.cylinder_location_name || "no rack"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ArtworkButtonProps {
  artworkId?: string | null;
  artworkCode?: string | null;
  artworkName?: string | null;
}

export function ArtworkButton({
  artworkId,
  artworkCode,
  artworkName,
}: ArtworkButtonProps) {
  const [open, setOpen] = React.useState(false);
  const enabled = Boolean(artworkId);

  if (!enabled) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        className="h-9 cursor-not-allowed rounded-[10px] border-line bg-surface-1 text-xs font-semibold text-content-4"
        data-testid="machine-artwork-button-empty"
      >
        <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
        No artwork attached
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 rounded-[10px] border-order-border bg-order-bg text-xs font-bold text-order-fg hover:bg-order-bg"
        data-testid="machine-artwork-button"
      >
        <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
        Artwork · {artworkCode || "view"}
      </Button>
      <ArtworkDialog
        open={open}
        onOpenChange={setOpen}
        artworkId={artworkId!}
        artworkCode={artworkCode || ""}
        artworkName={artworkName || ""}
      />
    </>
  );
}

function ArtworkDialog({
  open,
  onOpenChange,
  artworkId,
  artworkCode,
  artworkName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artworkId: string;
  artworkCode: string;
  artworkName: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["artwork-detail", artworkId],
    queryFn: async () => {
      const { data } = await api.get<ArtworkPayload>(
        `/api/engineering/artworks/${artworkId}/`,
      );
      return data;
    },
    enabled: open && Boolean(artworkId),
    staleTime: 60 * 1000,
  });

  const images = Array.isArray(data?.images) ? data!.images : [];
  const fallbackImage = data?.image;
  const hasImages = images.length > 0 || Boolean(fallbackImage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            Artwork · {artworkCode || data?.design_code || ""}
          </DialogTitle>
          <DialogDescription>
            {artworkName ||
              data?.name ||
              "Approved artwork on this committed job."}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-10 text-sm text-content-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading artwork…
          </div>
        ) : !hasImages ? (
          <div className="rounded-xl border border-dashed border-warning-border bg-warning-bg p-6 text-center text-sm text-warning-fg">
            This artwork has no images uploaded yet.
          </div>
        ) : (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
            {(images.length
              ? images.map((img) => img.image)
              : [fallbackImage as string]
            ).map((src, idx) => (
              <a
                key={src || idx}
                href={src || "#"}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "relative block overflow-hidden rounded-xl border border-line bg-surface-2",
                  "transition hover:border-order-border",
                )}
              >
                {src ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={src}
                    alt={`Artwork ${idx + 1}`}
                    className="h-56 w-full object-contain"
                  />
                ) : null}
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
