"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Disc,
  Loader2,
  Pencil,
  Plus,
  Wrench,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  artworkImageUrls,
  isPdfMediaUrl,
  normalizeMediaUrl,
  engineeringService,
  type Artwork,
  type Cylinder,
  type CylinderSlotAssignment,
} from "@/services/engineering";
import { masterDataService } from "@/services/master-data";
import { CylinderDialog } from "@/components/engineering/cylinder-dialog";
import { MasterRegistryShell } from "@/components/master/master-registry-shell";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";

type CylinderSlotView = {
  key: string;
  side: "FRONT" | "BACK";
  slot: number;
  color: string;
  cylinder?: Cylinder | null;
  assignment?: CylinderSlotAssignment | null;
};

function slotKey(side: string, slot: number) {
  return `${String(side || "FRONT").toUpperCase()}:${slot}`;
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fmtMm(value: unknown) {
  const number = asNumber(value, 0);
  if (number <= 0) return "-";
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function ArtworkCardMedia({
  src,
  name,
}: {
  src?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    if (isPdfMediaUrl(src)) {
      return (
        <iframe
          src={src}
          title={`${name} PDF preview`}
          className="h-full w-full bg-surface-1"
          onError={() => setFailed(true)}
        />
      );
    }
    return (
      <img
        src={src}
        alt={name}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-2 via-white to-info-bg text-content-4">
      <Disc className="h-12 w-12" />
    </div>
  );
}

function artworkSlots(
  artwork: Artwork,
  cylinders: Cylinder[],
  assignments: CylinderSlotAssignment[],
): CylinderSlotView[] {
  const legacyColors = (artwork.color_list || [])
    .map((value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const explicitFrontColors = (artwork.front_colors || [])
    .map((value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const backColors = (artwork.back_colors || []).map((value) =>
    String(value || "")
      .trim()
      .toUpperCase(),
  );
  const frontColors = explicitFrontColors.length
    ? explicitFrontColors
    : backColors.length
      ? []
      : legacyColors;
  const directBySlot = new Map<string, Cylinder>();
  const assignmentBySlot = new Map<string, CylinderSlotAssignment>();
  cylinders
    .filter((row) => String(row.artwork || "") === String(artwork.id))
    .forEach((row) =>
      directBySlot.set(
        slotKey(row.side || "FRONT", Number(row.side_slot_index || 0)),
        row,
      ),
    );
  assignments
    .filter((row) => String(row.artwork || "") === String(artwork.id))
    .forEach((row) =>
      assignmentBySlot.set(
        slotKey(row.side || "FRONT", Number(row.side_slot_index || 0)),
        row,
      ),
    );

  const rows: CylinderSlotView[] = [];
  const pushRows = (
    side: "FRONT" | "BACK",
    count: number,
    colors: string[],
  ) => {
    for (let index = 0; index < count; index += 1) {
      const slot = index + 1;
      const key = slotKey(side, slot);
      const assignment = assignmentBySlot.get(key) || null;
      const assignedCylinder = assignment
        ? cylinders.find(
            (row) => String(row.id) === String(assignment.cylinder),
          ) || null
        : null;
      rows.push({
        key,
        side,
        slot,
        color: colors[index] || `${side}-${slot}`,
        cylinder: assignedCylinder || directBySlot.get(key) || null,
        assignment,
      });
    }
  };
  const maxSlotForSide = (side: "FRONT" | "BACK") => {
    const prefix = `${side}:`;
    const keys = [...directBySlot.keys(), ...assignmentBySlot.keys()].filter(
      (key) => key.startsWith(prefix),
    );
    return keys.reduce(
      (max, key) => Math.max(max, Number(key.split(":")[1] || 0)),
      0,
    );
  };
  const legacyColorCount = Number(
    artwork.colors_count || legacyColors.length || 0,
  );
  const frontCount = Math.max(
    Number(
      artwork.front_colors_count ||
        frontColors.length ||
        (backColors.length ? 0 : legacyColorCount) ||
        0,
    ),
    maxSlotForSide("FRONT"),
  );
  const backCount = Math.max(
    Number(artwork.back_colors_count || backColors.length || 0),
    maxSlotForSide("BACK"),
  );
  pushRows("FRONT", frontCount, frontColors);
  if (
    String(artwork.substrate_mode || "SHEET").toUpperCase() === "TUBING" ||
    backCount > 0
  ) {
    pushRows("BACK", backCount, backColors);
  }
  return rows;
}

function CylinderArtworkGroupDialog({
  open,
  artwork,
  slots,
  cylinders,
  onOpenChange,
  onEditCylinder,
}: {
  open: boolean;
  artwork: Artwork | null;
  slots: CylinderSlotView[];
  cylinders: Cylinder[];
  onOpenChange: (open: boolean) => void;
  onEditCylinder: (cylinder: Cylinder) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [circumference, setCircumference] = useState("");
  const [cylinderLength, setCylinderLength] = useState("");
  const [diameter, setDiameter] = useState("100");
  const [cellDepth, setCellDepth] = useState("");
  const [vendor, setVendor] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "MAINTENANCE" | "SCRAP">(
    "ACTIVE",
  );
  const [selectedBySlot, setSelectedBySlot] = useState<Record<string, string>>(
    {},
  );
  const { data: vendorsRaw = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => masterDataService.getVendors(),
  });
  const { data: locationsRaw = [] } = useQuery({
    queryKey: ["locations", "TOOLING"],
    queryFn: () => masterDataService.getLocations("TOOLING"),
  });
  const vendors = Array.isArray(vendorsRaw) ? vendorsRaw : [];
  const locations = Array.isArray(locationsRaw) ? locationsRaw : [];

  useEffect(() => {
    if (!open) return;
    const first = slots.find((slot) => slot.cylinder)?.cylinder;
    setCircumference(
      artwork?.cylinder_circumference_mm
        ? String(artwork.cylinder_circumference_mm)
        : first?.circumference
          ? String(first.circumference)
          : "",
    );
    setCylinderLength(
      artwork?.cylinder_length_mm
        ? String(artwork.cylinder_length_mm)
        : first?.width_mm
          ? String(first.width_mm)
          : "",
    );
    setDiameter(first?.diameter_mm ? String(first.diameter_mm) : "100");
    setCellDepth(
      first?.cell_depth_microns ? String(first.cell_depth_microns) : "",
    );
    setVendor(first?.engraving_vendor || "");
    setLocation(first?.storage_location || "");
    setStatus(
      (["ACTIVE", "MAINTENANCE", "SCRAP"].includes(String(first?.status || ""))
        ? String(first?.status)
        : "ACTIVE") as "ACTIVE" | "MAINTENANCE" | "SCRAP",
    );
    setSelectedBySlot({});
  }, [open, artwork?.id, slots]);

  async function refreshCylinderMap() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cylinders"] }),
      queryClient.invalidateQueries({ queryKey: ["artworks"] }),
      queryClient.invalidateQueries({
        queryKey: ["cylinder-slot-assignments"],
      }),
    ]);
  }

  async function persistArtworkCylinderSpecs() {
    if (!artwork?.id) return;
    const repeat = asNumber(circumference, 0);
    const length = asNumber(cylinderLength, 0);
    if (repeat <= 0)
      throw new Error(
        "Enter circumference / repeat before using cylinder slots.",
      );
    if (length <= 0)
      throw new Error("Enter cylinder length before using cylinder slots.");
    if (
      Math.abs(asNumber(artwork.cylinder_circumference_mm, 0) - repeat) <=
        0.01 &&
      Math.abs(asNumber(artwork.cylinder_length_mm, 0) - length) <= 0.01
    )
      return;
    await engineeringService.updateArtwork(artwork.id, {
      cylinder_circumference_mm: repeat,
      cylinder_length_mm: length,
      update_in_place: true,
    });
  }

  const reuseCandidates = useMemo(() => {
    const repeat = asNumber(circumference, 0);
    const length = asNumber(cylinderLength, 0);
    return cylinders
      .filter((row) => !Boolean(row.is_draft))
      .filter((row) => Boolean(row.is_catalog_active ?? true))
      .filter((row) => asNumber(row.circumference, 0) > 0)
      .filter((row) => asNumber(row.width_mm, 0) > 0)
      .filter((row) => Boolean(row.engraving_vendor && row.storage_location))
      .filter((row) =>
        repeat > 0
          ? Math.abs(asNumber(row.circumference, 0) - repeat) <= 0.01
          : true,
      )
      .filter((row) =>
        length > 0
          ? Math.abs(asNumber(row.width_mm, 0) - length) <= 0.01
          : true,
      )
      .sort((left, right) =>
        String(left.code || "").localeCompare(String(right.code || "")),
      );
  }, [cylinders, circumference, cylinderLength]);

  const generateMutation = useMutation({
    mutationFn: async (slot: CylinderSlotView) => {
      if (!artwork?.id)
        throw new Error("Select an artwork before generating cylinders.");
      await persistArtworkCylinderSpecs();
      return engineeringService.generateArtworkCylinders(artwork.id, {
        side: slot.side,
        slot: slot.slot,
        circumference: asNumber(circumference, 0),
        length_mm: asNumber(cylinderLength, 0),
      });
    },
    onSuccess: async (_result, slot) => {
      await refreshCylinderMap();
      toast({
        title: "Draft cylinder generated",
        description: `${slot.side} ${slot.slot} is now waiting for vendor and location.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Generation blocked",
        description:
          err?.response?.data?.error?.message ||
          err?.response?.data?.detail ||
          err?.message ||
          "Could not generate this cylinder.",
        variant: "destructive",
      });
    },
  });

  const finalizeSlotMutation = useMutation({
    mutationFn: async (slot: CylinderSlotView) => {
      const cylinder = slot.cylinder;
      if (!cylinder?.id)
        throw new Error("This slot has no generated cylinder.");
      if (!vendor)
        throw new Error("Select engraving vendor before finalizing.");
      if (!location)
        throw new Error("Select storage location before finalizing.");
      await persistArtworkCylinderSpecs();
      return engineeringService.updateCylinder(cylinder.id, {
        diameter_mm: asNumber(diameter, 100),
        circumference: asNumber(circumference, 0),
        width_mm: asNumber(cylinderLength, 0),
        cell_depth_microns: asNumber(cellDepth, 0),
        engraving_vendor: vendor,
        storage_location: location,
        is_draft: false,
        lifecycle_status: status,
        status,
      });
    },
    onSuccess: async (_row, slot) => {
      await refreshCylinderMap();
      toast({
        title: "Cylinder finalized",
        description: `${slot.side} ${slot.slot} is now ready for approval.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Finalization blocked",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not finalize this cylinder.",
        variant: "destructive",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({
      slot,
      cylinderId,
    }: {
      slot: CylinderSlotView;
      cylinderId: string;
    }) => {
      await persistArtworkCylinderSpecs();
      return engineeringService.assignCylinderSlot({
        artwork: artwork?.id || "",
        cylinder: cylinderId,
        side: slot.side,
        side_slot_index: slot.slot,
      });
    },
    onSuccess: async (_row, variables) => {
      setSelectedBySlot((current) => ({
        ...current,
        [variables.slot.key]: "",
      }));
      await refreshCylinderMap();
      toast({
        title: "Cylinder reused",
        description: `${variables.slot.side} ${variables.slot.slot} now uses the selected physical cylinder.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Reuse failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not assign cylinder.",
        variant: "destructive",
      });
    },
  });

  if (!artwork) return null;

  const repeat = asNumber(circumference, 0);
  const length = asNumber(cylinderLength, 0);
  const coveredCount = slots.filter((slot) => slot.cylinder).length;
  const draftCount = slots.filter((slot) => slot.cylinder?.is_draft).length;
  const readyCount = slots.filter(
    (slot) => slot.cylinder && !slot.cylinder.is_draft,
  ).length;
  const slotSpecText = `${fmtMm(repeat)} × ${fmtMm(length)} mm`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[94vh] max-w-6xl overflow-hidden p-0"
        data-testid="cylinder-artwork-group-dialog"
      >
        <DialogHeader className="border-b border-line bg-surface-1 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-2xl font-black tracking-tight text-content-1">
                {artwork.design_code || artwork.name} cylinder map
              </DialogTitle>
              <div className="mt-1 text-sm text-content-3">
                {artwork.name} · {artwork.print_type || "PRINT"} ·{" "}
                {artwork.substrate_mode || "SHEET"} · {coveredCount}/
                {slots.length} slots covered
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SemanticBadge
                kind="severity"
                value={coveredCount === slots.length ? "LOW" : "MEDIUM"}
                label={`${readyCount} ready`}
              />
              <SemanticBadge
                kind="approval"
                value={draftCount ? "PENDING" : "APPROVED"}
                label={`${draftCount} draft`}
              />
              <Badge variant="outline" className="bg-surface-2">
                {slotSpecText}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[76vh] gap-5 overflow-y-auto bg-surface-2 p-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                1. Artwork cylinder spec
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3">
                    Circumference / repeat
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={circumference}
                    onChange={(event) => setCircumference(event.target.value)}
                    placeholder="420"
                    className="mt-2 bg-surface-1"
                    data-testid="cylinder-reuse-circumference"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3">
                    Cylinder length
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={cylinderLength}
                    onChange={(event) => setCylinderLength(event.target.value)}
                    placeholder="800"
                    className="mt-2 bg-surface-1"
                    data-testid="cylinder-reuse-length"
                  />
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-content-3">
                Reuse is filtered by {slotSpecText}. Vendor can be any.
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                2. Finish generated drafts
              </div>
              <div className="mt-3 space-y-3">
                <Select
                  value={vendor || "__NONE__"}
                  onValueChange={(value) =>
                    setVendor(value === "__NONE__" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className="bg-surface-1"
                    data-testid="cylinder-finalize-vendor"
                  >
                    <SelectValue placeholder="Engraving vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Select vendor</SelectItem>
                    {vendors.map((row: any) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={location || "__NONE__"}
                  onValueChange={(value) =>
                    setLocation(value === "__NONE__" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className="bg-surface-1"
                    data-testid="cylinder-finalize-location"
                  >
                    <SelectValue placeholder="Storage location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Select location</SelectItem>
                    {locations.map((row: any) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name} ({row.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as "ACTIVE" | "MAINTENANCE" | "SCRAP")
                  }
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                    <SelectItem value="SCRAP">SCRAP</SelectItem>
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={diameter}
                    onChange={(event) => setDiameter(event.target.value)}
                    placeholder="Diameter"
                    className="bg-surface-1"
                  />
                  <Input
                    type="number"
                    step="1"
                    value={cellDepth}
                    onChange={(event) => setCellDepth(event.target.value)}
                    placeholder="Cell depth"
                    className="bg-surface-1"
                  />
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-content-3">
                These values apply only when you press a slot&apos;s Finalize
                button. Empty slots can generate new or reuse an existing
                cylinder.
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                Matching reuse pool
              </div>
              <div className="mt-2 text-3xl font-black text-content-1">
                {reuseCandidates.length}
              </div>
              <div className="text-xs text-content-3">
                finalized cylinders with {slotSpecText}
              </div>
            </div>
          </aside>

          <div className="space-y-3">
            {slots.map((slot) => {
              const selected = selectedBySlot[slot.key] || "";
              const cylinder = slot.cylinder;
              const isDraft = Boolean(cylinder?.is_draft);
              const isReady = Boolean(cylinder && !cylinder.is_draft);
              const isReused = Boolean(
                slot.assignment &&
                  cylinder &&
                  String(cylinder.artwork || "") !== String(artwork.id),
              );
              const selectedCandidate = reuseCandidates.find(
                (candidate) => String(candidate.id) === selected,
              );
              const slotLabel = `${slot.side} ${slot.slot}`;
              const busy =
                generateMutation.isPending ||
                finalizeSlotMutation.isPending ||
                assignMutation.isPending;
              return (
                <div
                  key={slot.key}
                  className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm"
                  data-testid={`cylinder-slot-${slot.side}-${slot.slot}`}
                >
                  <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{slotLabel}</Badge>
                        <div className="text-base font-black text-content-1">
                          {slot.color || "Color pending"}
                        </div>
                        {isDraft ? (
                          <SemanticBadge
                            kind="approval"
                            value="PENDING"
                            label="Draft generated"
                          />
                        ) : isReady ? (
                          <SemanticBadge
                            kind="approval"
                            value="APPROVED"
                            label={isReused ? "Reused ready" : "Ready"}
                          />
                        ) : (
                          <SemanticBadge
                            kind="severity"
                            value="MEDIUM"
                            label="Empty slot"
                          />
                        )}
                      </div>
                      <p className="mt-2 text-xs font-semibold text-content-3">
                        Reuse is filtered by {slotSpecText}. Vendor can be any.
                      </p>
                      {cylinder ? (
                        <div className="mt-3 grid gap-2 text-sm text-content-3 sm:grid-cols-3">
                          <div>
                            <div className="font-black text-content-1">
                              {cylinder.code}
                            </div>
                            <div>
                              {cylinder.artwork_name || "Current artwork"}
                            </div>
                          </div>
                          <div>
                            <div>{fmtMm(cylinder.circumference)} mm repeat</div>
                            <div>{fmtMm(cylinder.width_mm)} mm length</div>
                          </div>
                          <div>
                            <div>
                              {cylinder.vendor_name ||
                                cylinder.engraving_vendor_name ||
                                "Vendor pending"}
                            </div>
                            <div>
                              {cylinder.location_name || "Location pending"}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-4 text-sm text-content-3">
                          Generate a new cylinder for this color, or reuse a
                          finalized cylinder with the same repeat and length.
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {!cylinder ? (
                        <>
                          <Button
                            className="w-full"
                            disabled={busy || repeat <= 0 || length <= 0}
                            onClick={() => generateMutation.mutate(slot)}
                            data-testid={`cylinder-generate-slot-${slot.side}-${slot.slot}`}
                          >
                            {generateMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 h-4 w-4" />
                            )}
                            Generate new for this color
                          </Button>
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <Select
                              value={selected || "__NONE__"}
                              onValueChange={(value) =>
                                setSelectedBySlot((current) => ({
                                  ...current,
                                  [slot.key]: value === "__NONE__" ? "" : value,
                                }))
                              }
                            >
                              <SelectTrigger
                                className="bg-surface-1"
                                data-testid={`cylinder-reuse-${slot.side}-${slot.slot}`}
                              >
                                <SelectValue placeholder="Reuse matching cylinder" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__NONE__">
                                  Select matching cylinder
                                </SelectItem>
                                {reuseCandidates.map((candidate) => (
                                  <SelectItem
                                    key={candidate.id}
                                    value={candidate.id}
                                  >
                                    {candidate.code} ·{" "}
                                    {candidate.color_name || "Color"} ·{" "}
                                    {candidate.artwork_name || "Unlinked"} ·{" "}
                                    {fmtMm(candidate.circumference)}×
                                    {fmtMm(candidate.width_mm)} mm
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              disabled={!selected || assignMutation.isPending}
                              onClick={() =>
                                assignMutation.mutate({
                                  slot,
                                  cylinderId: selected,
                                })
                              }
                              data-testid={`cylinder-use-slot-${slot.side}-${slot.slot}`}
                            >
                              Use
                            </Button>
                          </div>
                          {selectedCandidate ? (
                            <div className="rounded-xl bg-success-bg px-3 py-2 text-xs font-semibold text-success-fg">
                              Selected {selectedCandidate.code} from{" "}
                              {selectedCandidate.artwork_name || "catalog"}.
                            </div>
                          ) : null}
                        </>
                      ) : isDraft ? (
                        <>
                          <Button
                            className="w-full bg-success-fg text-white hover:bg-success-fg"
                            disabled={
                              busy ||
                              !vendor ||
                              !location ||
                              repeat <= 0 ||
                              length <= 0
                            }
                            onClick={() => finalizeSlotMutation.mutate(slot)}
                            data-testid={`cylinder-finalize-slot-${slot.side}-${slot.slot}`}
                          >
                            {finalizeSlotMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                            )}
                            Finalize this cylinder
                          </Button>
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => onEditCylinder(cylinder)}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Edit draft
                            details
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-center text-xs font-black uppercase tracking-[0.12em] text-success-fg">
                            Slot complete
                          </div>
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => onEditCylinder(cylinder)}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Edit cylinder
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CylinderManagementPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cylinder | null>(null);
  const [groupArtwork, setGroupArtwork] = useState<Artwork | null>(null);

  const { data: cylindersRaw = [], isLoading } = useQuery({
    queryKey: ["cylinders"],
    queryFn: () => engineeringService.getCylinders(),
  });
  const { data: artworksRaw = [] } = useQuery<Artwork[]>({
    queryKey: ["artworks"],
    queryFn: () => engineeringService.getArtworks(),
  });
  const { data: assignmentsRaw = [] } = useQuery<CylinderSlotAssignment[]>({
    queryKey: ["cylinder-slot-assignments"],
    queryFn: () => engineeringService.getCylinderSlotAssignments(),
  });
  const cylinders = Array.isArray(cylindersRaw) ? cylindersRaw : [];
  const artworks = Array.isArray(artworksRaw) ? artworksRaw : [];
  const assignments = Array.isArray(assignmentsRaw) ? assignmentsRaw : [];

  const groups = useMemo(() => {
    const artworkById = new Map(
      artworks.map((artwork) => [String(artwork.id), artwork]),
    );
    for (const cylinder of cylinders) {
      if (cylinder.artwork && !artworkById.has(String(cylinder.artwork))) {
        artworkById.set(String(cylinder.artwork), {
          id: String(cylinder.artwork),
          design_code: "",
          name: cylinder.artwork_name || "Linked artwork",
          print_type: "ROTO",
          substrate_mode: "TUBING",
          color_list: [],
          colors_count: 0,
          cylinder_circumference_mm: cylinder.circumference,
          cylinder_length_mm: cylinder.width_mm,
          file_path: "",
          image: cylinder.artwork_image || null,
          primary_image: cylinder.artwork_image || null,
          images: cylinder.artwork_image
            ? [{ id: "linked", image: cylinder.artwork_image, sort_order: 0 }]
            : [],
          version: 1,
          status: "DRAFT",
          created_at: "",
        } as Artwork);
      }
    }
    return Array.from(artworkById.values())
      .map((artwork) => ({
        artwork,
        slots: artworkSlots(artwork, cylinders, assignments),
      }))
      .filter(
        (group) =>
          group.slots.length > 0 ||
          cylinders.some(
            (row) => String(row.artwork || "") === String(group.artwork.id),
          ),
      );
  }, [artworks, cylinders, assignments]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => {
      const haystack = [
        group.artwork.design_code,
        group.artwork.name,
        group.artwork.print_type,
        group.artwork.substrate_mode,
        ...group.slots.flatMap((slot) => [
          slot.color,
          slot.cylinder?.code,
          slot.cylinder?.name,
          slot.cylinder?.artwork_name,
        ]),
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [groups, searchQuery]);

  const stats = useMemo(
    () => ({
      total: filtered.reduce((sum, group) => sum + group.slots.length, 0),
      draft: filtered.reduce(
        (sum, group) =>
          sum + group.slots.filter((slot) => slot.cylinder?.is_draft).length,
        0,
      ),
      ready: filtered.reduce(
        (sum, group) =>
          sum +
          group.slots.filter((slot) => slot.cylinder && !slot.cylinder.is_draft)
            .length,
        0,
      ),
      service: cylinders.filter((row) =>
        ["MAINTENANCE", "RE_CHROME"].includes(
          String(row.status || "").toUpperCase(),
        ),
      ).length,
    }),
    [filtered, cylinders],
  );

  return (
    <MasterRegistryShell
      title="Cylinder Catalog"
      description="Artwork-linked print tooling with side-slot mapping, lifecycle, vendor, and storage visibility."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search cylinder code, artwork, color, lifecycle, or storage"
      actions={
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          data-testid="cylinder-new-button"
        >
          <Plus className="mr-2 h-4 w-4" /> New Cylinder
        </Button>
      }
      stats={[
        {
          label: "Total Cylinders",
          value: stats.total,
          icon: Disc,
          toneClassName: "bg-info-bg text-primary",
        },
        {
          label: "Draft",
          value: stats.draft,
          icon: Pencil,
          toneClassName: "bg-warning-bg text-warning-fg",
        },
        {
          label: "Production Ready",
          value: stats.ready,
          icon: Disc,
          toneClassName: "bg-success-bg text-success-fg",
        },
        {
          label: "Service Focus",
          value: stats.service,
          icon: Wrench,
          toneClassName: "bg-danger-bg text-danger-fg",
        },
      ]}
      chips={[
        { kind: "toolingStatus", value: "READY" },
        { kind: "toolingStatus", value: "MAINTENANCE" },
        { kind: "toolingStatus", value: "SERVICE_DUE" },
      ]}
    >
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card
              key={index}
              className="h-[320px] border-0 shadow-sm ring-1 ring-line"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm ring-1 ring-line">
          <CardContent className="p-10 text-center text-content-4">
            No cylinders found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((group) => {
            const covered = group.slots.filter((slot) => slot.cylinder).length;
            const draft = group.slots.filter(
              (slot) => slot.cylinder?.is_draft,
            ).length;
            const ready = group.slots.filter(
              (slot) => slot.cylinder && !slot.cylinder.is_draft,
            ).length;
            const firstCylinder =
              group.slots.find((slot) => slot.cylinder)?.cylinder || null;
            const artworkImage =
              artworkImageUrls(group.artwork)[0] ||
              normalizeMediaUrl(firstCylinder?.artwork_image) ||
              null;
            return (
              <Card
                key={group.artwork.id}
                className="overflow-hidden border-0 shadow-sm ring-1 ring-line"
              >
                <div className="relative h-40 overflow-hidden bg-surface-2">
                  <ArtworkCardMedia
                    src={artworkImage}
                    name={group.artwork.name}
                  />
                </div>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black tracking-tight text-content-1">
                        {group.artwork.name}
                      </div>
                      <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-content-4">
                        {group.artwork.design_code || "ARTWORK"}
                      </div>
                    </div>
                    <SemanticBadge
                      kind="toolingStatus"
                      value={
                        covered === group.slots.length ? "READY" : "SERVICE_DUE"
                      }
                      label={`${covered}/${group.slots.length} covered`}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <SemanticBadge
                      kind="approval"
                      value={draft ? "PENDING" : "APPROVED"}
                      label={draft ? `${draft} draft` : `${ready} ready`}
                    />
                    <SemanticBadge
                      kind="severity"
                      value="INFO"
                      label={`${group.artwork.print_type || "PRINT"} · ${group.artwork.substrate_mode || "SHEET"}`}
                    />
                    {Number(group.artwork.cylinder_circumference_mm || 0) > 0 &&
                    Number(group.artwork.cylinder_length_mm || 0) > 0 ? (
                      <SemanticBadge
                        kind="severity"
                        value="LOW"
                        label={`${group.artwork.cylinder_circumference_mm}×${group.artwork.cylinder_length_mm} mm`}
                      />
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Front / Back
                      </div>
                      <div className="mt-1 font-bold text-content-1">
                        F{group.artwork.front_colors_count || 0} / B
                        {group.artwork.back_colors_count || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Empty Slots
                      </div>
                      <div className="mt-1 font-bold text-content-1">
                        {Math.max(0, group.slots.length - covered)}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Slot Colors
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {group.slots.slice(0, 8).map((slot) => (
                          <span
                            key={slot.key}
                            className={`rounded-full border px-2 py-1 text-[10px] font-bold ${slot.cylinder ? "border-success-border bg-success-bg text-success-fg" : "border-line bg-surface-1 text-content-3"}`}
                          >
                            {slot.side[0]}
                            {slot.slot} {slot.color}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl border border-line bg-surface-1 p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Ready
                      </div>
                      <div className="mt-1 font-black text-content-1">
                        {ready}
                      </div>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-1 p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Draft
                      </div>
                      <div className="mt-1 font-black text-content-1">
                        {draft}
                      </div>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-1 p-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                        Reuse
                      </div>
                      <div className="mt-1 font-black text-content-1">
                        {
                          group.slots.filter(
                            (slot) =>
                              slot.assignment &&
                              slot.cylinder?.artwork !== group.artwork.id,
                          ).length
                        }
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGroupArtwork(group.artwork)}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Manage Slots
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CylinderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cylinder={editing}
      />
      <CylinderArtworkGroupDialog
        open={Boolean(groupArtwork)}
        artwork={groupArtwork}
        slots={
          groupArtwork ? artworkSlots(groupArtwork, cylinders, assignments) : []
        }
        cylinders={cylinders}
        onOpenChange={(open) => {
          if (!open) setGroupArtwork(null);
        }}
        onEditCylinder={(cylinder) => {
          setEditing(cylinder);
          setDialogOpen(true);
        }}
      />
    </MasterRegistryShell>
  );
}
