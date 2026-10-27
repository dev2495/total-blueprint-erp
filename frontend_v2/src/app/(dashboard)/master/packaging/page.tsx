"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Factory,
  Package,
  PackageOpen,
  Plus,
  ShoppingBag,
} from "lucide-react";

import {
  masterDataService,
  type PackagingMaterial,
} from "@/services/master-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MasterRegistryShell } from "@/components/master/master-registry-shell";
import { CatalogLinkPanel } from "@/components/master/catalog-link";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";
import { cn } from "@/lib/utils";

const kinds = [
  "INNER_POUCH",
  "GONNY",
  "SHEET",
  "BOX",
  "OUTER_BAG",
  "TAPE",
  "LABEL",
  "TAG",
  "OTHER",
] as const;

/** What each kind is, in floor words, and how the packing yard uses it. */
const KIND_INFO: Record<(typeof kinds)[number], { label: string; usage: string }> = {
  INNER_POUCH: {
    label: "Inner pouch",
    usage: "Holds pouches inside a gonny. Taken off stock automatically at packing, so it is never in the release tick list.",
  },
  GONNY: { label: "Gonny", usage: "In the release tick list; chosen on each pouch unit too. Counted every evening." },
  SHEET: { label: "Sheet · putha · board", usage: "In the release tick list; counted every evening." },
  BOX: { label: "Box · carton", usage: "In the release tick list; counted every evening." },
  OUTER_BAG: { label: "Outer bag · packing pouch", usage: "In the release tick list; counted every evening." },
  TAPE: { label: "Tape", usage: "In the release tick list; counted every evening." },
  LABEL: { label: "Label", usage: "In the release tick list; counted every evening." },
  TAG: { label: "Tag", usage: "In the release tick list; counted every evening." },
  OTHER: { label: "Other packing item", usage: "In the release tick list; counted every evening." },
};
const supplyModes = ["PURCHASED", "IN_HOUSE", "BOTH"] as const;
const uoms = ["PCS", "KG", "METER"] as const;

type PackagingKind = (typeof kinds)[number];
type PackagingSupplyMode = (typeof supplyModes)[number];
type PackagingUom = (typeof uoms)[number];

function describeError(err: any) {
  return (
    err?.response?.data?.detail ||
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    "Error"
  );
}

function PackagingForm({
  initial,
  onSubmit,
  busy,
}: {
  initial?: PackagingMaterial | null;
  onSubmit: (payload: any) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState(initial?.code || "");
  const [name, setName] = useState(initial?.name || "");
  const [baseUom, setBaseUom] = useState<PackagingUom>(
    (initial?.base_uom as PackagingUom) || "PCS",
  );
  // No default: a new item's kind decides whether it is ticked at release (everything but inner
  // pouches) or taken automatically at packing, so it is always chosen on purpose.
  const [kind, setKind] = useState<PackagingKind | "">((initial?.packaging_kind as PackagingKind) || "");
  const [supplyMode, setSupplyMode] = useState<PackagingSupplyMode>(
    (initial?.packaging_supply_mode as PackagingSupplyMode) || "PURCHASED",
  );
  // Weight of one bought pouch or gonny: per_sheet_base_qty when stocked in kg, otherwise
  // packaging_defaults_json.weight_kg_per_base_uom.
  const [pieceWeight, setPieceWeight] = useState(() => {
    const stored =
      String(initial?.base_uom || "").toUpperCase() === "KG"
        ? initial?.per_sheet_base_qty
        : initial?.packaging_defaults_json?.weight_kg_per_base_uom;
    return stored ? String(stored) : "";
  });
  const [status, setStatus] = useState(initial?.status || "ACTIVE");
  const [brandName, setBrandName] = useState(
    String(initial?.packaging_defaults_json?.brand_name || ""),
  );
  const [defaultPcsPerPack, setDefaultPcsPerPack] = useState(
    initial?.packaging_defaults_json?.pcs_per_pack != null
      ? String(initial.packaging_defaults_json?.pcs_per_pack)
      : "",
  );
  const allowInHouse = ["INNER_POUCH", "SHEET"].includes(kind);
  const supplyModeOptions = allowInHouse
    ? supplyModes
    : (["PURCHASED"] as const);
  // Only inner pouches and gonnies weigh anything in a dispatch unit. In-house pouches take
  // it from their Product Master BOM; bought pouches and gonnies need it entered here.
  const weighed = kind === "INNER_POUCH" || kind === "GONNY";
  const inHousePouch = kind === "INNER_POUCH" && supplyMode === "IN_HOUSE";
  const weightRequired = weighed && (supplyMode === "PURCHASED" || kind === "GONNY");
  const weightEntered = weightRequired || (kind === "INNER_POUCH" && supplyMode === "BOTH");
  const bomMeasure = initial?.stock_measure?.source === "BOM" ? initial.stock_measure : null;
  const unitLabel = kind === "INNER_POUCH" ? "pouch" : kind ? kind.replaceAll("_", " ").toLowerCase() : "item";

  useEffect(() => {
    if (!allowInHouse && supplyMode !== "PURCHASED") {
      setSupplyMode("PURCHASED");
    }
  }, [allowInHouse, supplyMode]);

  useEffect(() => {
    if (kind !== "INNER_POUCH") {
      setDefaultPcsPerPack("");
    }
  }, [kind]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const packagingDefaults = {
          ...(initial?.packaging_defaults_json || {}),
        };
        if (brandName) {
          packagingDefaults.brand_name = brandName;
        } else {
          delete packagingDefaults.brand_name;
        }
        if (defaultPcsPerPack) {
          packagingDefaults.pcs_per_pack = Number(defaultPcsPerPack);
        } else {
          delete packagingDefaults.pcs_per_pack;
        }
        const keepWeight = weightEntered && Number(pieceWeight) > 0;
        if (keepWeight && baseUom !== "KG") {
          packagingDefaults.weight_kg_per_base_uom = Number(pieceWeight);
        } else {
          delete packagingDefaults.weight_kg_per_base_uom;
        }
        onSubmit({
          code,
          name,
          base_uom: baseUom,
          packaging_kind: kind,
          packaging_supply_mode: supplyMode,
          production_template: null,
          packaging_defaults_json: packagingDefaults,
          per_sheet_base_qty: keepWeight && baseUom === "KG" ? Number(pieceWeight) : null,
          status,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Kind</Label>
          <Select
            value={kind || undefined}
            onValueChange={(value) => setKind(value as PackagingKind)}
          >
            <SelectTrigger aria-invalid={!kind} data-testid="packaging-kind-select">
              <SelectValue placeholder="What is this item?" />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_INFO[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={cn("mt-1 text-[11.5px]", kind === "INNER_POUCH" ? "text-warning-fg" : "text-content-3")} data-testid="packaging-kind-usage">
            {kind ? KIND_INFO[kind].usage : "Pick the kind first: it decides how the packing yard uses this item."}
          </p>
        </div>
        <div>
          <Label>Supply Mode</Label>
          <Select
            value={supplyMode}
            onValueChange={(value) =>
              setSupplyMode(value as PackagingSupplyMode)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supplyModeOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Base UOM</Label>
          <Select
            value={baseUom}
            onValueChange={(value) => setBaseUom(value as PackagingUom)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {uoms.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="packaging-piece-measure">
            {weighed ? `Weight of one ${unitLabel} (kg)` : "Weight"}
          </Label>
          {inHousePouch ? (
            bomMeasure ? (
              <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg" data-testid="packaging-bom-weight">
                <span className="font-semibold tabular-nums">{fmtPieceWeight(bomMeasure.weight_kg_per_piece)}</span> from the BOM of{" "}
                {bomMeasure.bom?.master_code} / {bomMeasure.bom?.variant_code}. Change the size or layers on that Product Master to change it.
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg">
                In-house pouches weigh what their Product Master BOM says. Save, then link this pouch to its packaging Product Master variant.
              </div>
            )
          ) : weightEntered ? (
            <>
              <Input
                id="packaging-piece-measure"
                type="number"
                step="0.000001"
                min="0.000001"
                required={weightRequired}
                value={pieceWeight}
                onChange={(e) => setPieceWeight(e.target.value)}
                placeholder="e.g. 0.012"
              />
              <div className="mt-1 text-xs text-content-3">
                Goes into each dispatch unit&apos;s weight: product + inner pouches + gonny.
                {baseUom === "KG" ? " Also turns pouches into kg of stock." : ""}
                {supplyMode === "BOTH" ? " Once linked to its Product Master, the BOM weight is used instead." : ""}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-content-3">
              No weight. Counted in {baseUom} at the evening packing count
              {supplyMode !== "PURCHASED" ? "; its Product Master BOM only says how to make it" : ""}.
            </div>
          )}
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
              <SelectItem value="INACTIVE">INACTIVE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {supplyMode !== "PURCHASED" ? (
        <div className="rounded-xl border border-order-border bg-order-bg px-3 py-2 text-xs text-order-fg">
          In-house production is controlled by a linked Product Master variant.
          Save the catalog row here, then link it from the matching PACKAGING
          variant if it is not already PM-backed.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Brand / Pack Label</Label>
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Optional branded pack name"
          />
        </div>
      </div>

      {kind === "INNER_POUCH" ? (
        <div>
          <Label>Default PCS per Inner Pack</Label>
          <Input
            type="number"
            value={defaultPcsPerPack}
            onChange={(e) => setDefaultPcsPerPack(e.target.value)}
            placeholder="Optional default for known inner-pack consumption"
          />
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !kind}>
          Save
        </Button>
      </div>
    </form>
  );
}

export default function PackagingMasterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<PackagingMaterial | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data = [],
    isError,
    error,
  } = useQuery({
    queryKey: ["master-packaging"],
    queryFn: masterDataService.getPackaging,
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row: PackagingMaterial) =>
      [
        row.code,
        row.name,
        row.packaging_kind,
        row.packaging_supply_mode,
        row.product_master_link?.master_code,
        row.product_master_link?.variant_code,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(q),
    );
  }, [data, searchQuery]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const purchased = filtered.filter(
      (row) => row.packaging_supply_mode === "PURCHASED",
    ).length;
    const pmBacked = filtered.filter((row) => !!row.product_master_link).length;
    const unlinkedInHouse = filtered.filter(
      (row) =>
        row.packaging_supply_mode !== "PURCHASED" && !row.product_master_link,
    ).length;
    return { total, purchased, pmBacked, unlinkedInHouse };
  }, [filtered]);

  const createMutation = useMutation({
    mutationFn: masterDataService.createPackaging,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] });
      setOpenCreate(false);
      toast({ title: "Packaging created" });
    },
    onError: (err: any) =>
      toast({
        title: "Create failed",
        description: describeError(err),
        variant: "destructive",
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      masterDataService.updatePackaging(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] });
      setEditing(null);
      toast({ title: "Packaging updated" });
    },
    onError: (err: any) =>
      toast({
        title: "Update failed",
        description: describeError(err),
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: masterDataService.deletePackaging,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-packaging"] });
      toast({ title: "Packaging deleted" });
    },
    onError: (err: any) =>
      toast({
        title: "Delete failed",
        description: describeError(err),
        variant: "destructive",
      }),
  });

  return (
    <MasterRegistryShell
      title="Packaging Master"
      description="Control fixed inner pouch/gonny SKUs plus sheet, tape, label, tag, and other EOD-counted packing SKUs."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search packaging code, name, kind, or supply mode"
      actions={
        <div className="flex items-center gap-2">
          {/* In-house production masters live on /master/products with kind=PACKAGING.
 Each variant must be manually linked to one fixed row in this
 catalog for stock + consumption tracking. */}
          <Link
            href="/master/products?kind=PACKAGING"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-order-border bg-surface-2 px-3 text-caption font-bold text-order-fg hover:from-order-bg hover:to-order-bg transition"
            title="Create an in-house production master that produces packing SKUs into this catalog"
          >
            <Plus className="h-3.5 w-3.5" /> Build production master
          </Link>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add Packaging
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Create Packaging Material</DialogTitle>
              </DialogHeader>
              <PackagingForm
                onSubmit={(payload) => createMutation.mutate(payload)}
                busy={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
      }
      stats={[
        {
          label: "Total SKUs",
          value: stats.total,
          icon: Package,
          toneClassName: "bg-info-bg text-primary",
        },
        {
          label: "PM-Backed",
          value: stats.pmBacked,
          subLabel: "linked variant",
          icon: PackageOpen,
          toneClassName: "bg-success-bg text-success-fg",
        },
        {
          label: "Unlinked In-House",
          value: stats.unlinkedInHouse,
          subLabel: "needs PM link",
          icon: Factory,
          toneClassName: "bg-danger-bg text-danger-fg",
        },
        {
          label: "Purchased",
          value: stats.purchased,
          icon: ShoppingBag,
          toneClassName: "bg-warning-bg text-warning-fg",
        },
      ]}
      chips={[
        { kind: "packagingKind", value: "INNER_POUCH" },
        { kind: "packagingKind", value: "GONNY" },
        { kind: "packagingKind", value: "SHEET" },
        { kind: "packagingKind", value: "TAPE" },
        { kind: "packagingKind", value: "LABEL" },
      ]}
    >
      {isError ? (
        <Card className="border-danger-border bg-danger-bg">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-danger-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{describeError(error)}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => {
          const link = row.product_master_link;
          const unlinkedInHouse =
            row.packaging_supply_mode !== "PURCHASED" && !link;
          return (
            <Card key={row.id} className="border-0 shadow-sm ring-1 ring-line">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold tracking-tight text-content-1">
                      {row.name}
                    </div>
                    <div className="mt-1 font-mono text-[12px] font-semibold text-content-3">
                      {row.code}
                    </div>
                  </div>
                  <SemanticBadge
                    kind="packagingKind"
                    value={row.packaging_kind}
                  />
                </div>
                <p
                  className={cn(
                    "-mt-2 text-[11.5px]",
                    String(row.packaging_kind || "").toUpperCase() === "INNER_POUCH" ? "text-warning-fg" : "text-content-3",
                  )}
                  data-testid={`packaging-usage-${row.id}`}
                >
                  {KIND_INFO[String(row.packaging_kind || "").toUpperCase() as PackagingKind]?.usage || "Ticked at release when used; counted every evening."}
                </p>

                <div className="flex flex-wrap gap-2">
                  <SemanticBadge
                    kind="jobState"
                    value={
                      row.packaging_supply_mode === "IN_HOUSE"
                        ? "READY"
                        : row.packaging_supply_mode === "BOTH"
                          ? "ASSIGNED"
                          : "PENDING"
                    }
                    label={row.packaging_supply_mode.replaceAll("_", " ")}
                  />
                  <SemanticBadge
                    kind="approval"
                    value={row.status === "ACTIVE" ? "APPROVED" : "REJECTED"}
                    label={row.status}
                  />
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-caption font-semibold uppercase tracking-wider ring-1 ${
                      link
                        ? "bg-success-bg text-success-fg ring-success-border"
                        : unlinkedInHouse
                          ? "bg-danger-bg text-danger-fg ring-danger-border"
                          : "bg-surface-2 text-content-3 ring-line"
                    }`}
                  >
                    {link
                      ? "PM-backed"
                      : unlinkedInHouse
                        ? "Needs PM link"
                        : "Catalog row"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
                  <div>
                    <div className="text-[12px] font-semibold text-content-3">
                      Base UOM
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      {row.base_uom}
                    </div>
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-content-3">
                      Weight of one piece
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      <PieceMeasure row={row} />
                    </div>
                  </div>
                  <div className="col-span-2 grid gap-1 text-[12.5px]" data-testid="packaging-stock-rules">
                    <StockRules row={row} />
                  </div>
                  <div className="col-span-2">
                    <CatalogLinkPanel
                      row={row}
                      linkable={["INNER_POUCH", "SHEET"].includes(String(row.packaging_kind || "").toUpperCase())}
                      kindLabel="packaging"
                      invalidateKeys={[["master-packaging"]]}
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="text-[12px] font-semibold text-content-3">
                      Default Brand / Pack Config
                    </div>
                    <div className="mt-1 text-sm text-content-2">
                      {row.packaging_defaults_json?.brand_name ||
                        "No branded default"}
                      {row.packaging_defaults_json?.pcs_per_pack
                        ? ` • ${row.packaging_defaults_json.pcs_per_pack} pcs/pack`
                        : ""}
                      {row.packaging_defaults_json?.weight_kg_per_base_uom
                        ? ` • ${row.packaging_defaults_json.weight_kg_per_base_uom} kg/${row.base_uom.toLowerCase()}`
                        : ""}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMutation.mutate(row.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Packaging Material</DialogTitle>
          </DialogHeader>
          {editing ? (
            <PackagingForm
              initial={editing}
              busy={updateMutation.isPending}
              onSubmit={(payload) =>
                updateMutation.mutate({ id: editing.id, payload })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </MasterRegistryShell>
  );
}

function fmtPieceWeight(kg: number | null | undefined) {
  if (!kg) return "—";
  return kg < 1 ? `${(kg * 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} g per piece` : `${kg.toLocaleString("en-IN", { maximumFractionDigits: 4 })} kg per piece`;
}

/** Weight of one inner pouch or gonny and where it comes from; other items carry none. */
function PieceMeasure({ row }: { row: PackagingMaterial }) {
  const m = row.stock_measure;
  if (!m || m.source === "NOT_WEIGHED") {
    return <span className="font-medium text-content-2">No weight · counted in {row.base_uom}</span>;
  }
  if (m.source === "BOM") {
    return (
      <span data-testid="packaging-piece-from-bom">
        {fmtPieceWeight(m.weight_kg_per_piece)}{" "}
        <span className="font-medium text-success-fg">· BOM of {m.bom?.master_code} / {m.bom?.variant_code}</span>
      </span>
    );
  }
  if (m.source === "MASTER") {
    return <>{fmtPieceWeight(m.weight_kg_per_piece)} <span className="font-medium text-content-3">· entered on this master</span></>;
  }
  return (
    <span className="font-semibold text-warning-fg" data-testid="packaging-missing-piece-weight">
      {m.stock_rule === "AT_MACHINE"
        ? "Missing. Link it to its packaging Product Master variant"
        : "Missing. Edit and enter the weight of one piece"}
    </span>
  );
}

/** When the item comes off stock, and how it is restocked. */
function StockRules({ row }: { row: PackagingMaterial }) {
  const m = row.stock_measure;
  if (!m) return null;
  const stock =
    m.stock_rule === "AT_MACHINE"
      ? "Taken off stock at the machine as pieces are logged (by weight), per order"
      : "Taken off stock by the evening packing count, booked to the orders that used it";
  const demand =
    m.demand_rule === "AUTO"
      ? "Demanded automatically when an order is short"
      : m.demand_rule === "MANUAL_STOCK_LAUNCHER"
        ? "Restocked by hand from the Stock launcher"
        : "Bought: restocked by purchase";
  return (
    <>
      <div><span className="font-semibold text-content-3">Stock · </span><span className="text-content-1">{stock}</span></div>
      <div><span className="font-semibold text-content-3">Restock · </span><span className="text-content-1">{demand}</span></div>
    </>
  );
}
