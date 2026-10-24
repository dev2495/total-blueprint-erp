"use client";

import { productMasterService } from "@/services/product-master";
import { mmWithInches, standardSizeName } from "@/lib/size-naming";
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  FileSpreadsheet,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  computeProductGeometry,
  resolveProductOutputKind,
} from "@/lib/product-geometry";
import { cn } from "@/lib/utils";
import type { ProductKind, ProductMasterSize } from "@/services/product-master";
import { SizeGeometryEditor } from "@/components/product-master/size-geometry-editor";

type OutputKind = "POUCH" | "ROLL" | "OTHER";
type BulkAction = "create" | "update";
type FilterMode = "all" | "active" | "inactive" | "overridden";

interface ProductSizeWorkspaceProps {
  rows: ProductMasterSize[];
  productId: string;
  kind: ProductKind | string;
  packagingKind?: string | null;
  fixedFgType?: string | null;
  onAdd: () => void;
  onPatch: (index: number, patch: Partial<ProductMasterSize>) => void;
  onRemove: (index: number) => void;
  onBulkApply: (rows: ProductMasterSize[]) => void;
  onRequestSave?: () => void;
  canRequestSave?: boolean;
  isSaving?: boolean;
}

interface ReviewRow {
  id: string;
  action: BulkAction;
  row: ProductMasterSize;
  errors: string[];
  /** Code / label were left blank in the sheet and come from the size (they follow size edits). */
  auto?: { code: boolean; label: boolean };
}

const COMMON_UOMS = ["KG", "PCS", "METER"] as const;
export function ProductSizeWorkspace({
  rows,
  productId,
  kind,
  packagingKind,
  fixedFgType,
  onAdd,
  onPatch,
  onRemove,
  onBulkApply,
  onRequestSave,
  canRequestSave = true,
  isSaving = false,
}: ProductSizeWorkspaceProps) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<FilterMode>("all");
  const [bulkMode, setBulkMode] = React.useState(false);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [reviewRows, setReviewRows] = React.useState<ReviewRow[]>([]);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const outputKind = resolveProductOutputKind(kind, packagingKind, fixedFgType);
  const normalizedOutput =
    outputKind === "POUCH" || outputKind === "ROLL" ? outputKind : "OTHER";

  React.useEffect(() => {
    if (!rows.length) {
      setSelectedIndex(0);
      setSelectedKeys(new Set());
      return;
    }
    setSelectedIndex((index) => Math.min(Math.max(index, 0), rows.length - 1));
  }, [rows.length]);

  React.useEffect(() => {
    setSelectedKeys((current) => {
      const liveKeys = new Set(
        rows.map((row, index) => sizeRowKey(row, index)),
      );
      const next = new Set(
        Array.from(current).filter((key) => liveKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const selectedRow = rows[selectedIndex] || null;
  const visibleRows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (filterMode === "active" && row.active === false) return false;
        if (filterMode === "inactive" && row.active !== false) return false;
        if (
          filterMode === "overridden" &&
          !isOverriddenSize(row, normalizedOutput)
        )
          return false;
        if (!needle) return true;
        return [row.code, row.label, row.notes, row.roll_form, row.pouch_style]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(needle));
      });
  }, [rows, search, filterMode, normalizedOutput]);
  const selectedVisibleCount = React.useMemo(
    () =>
      visibleRows.filter(({ row, index }) =>
        selectedKeys.has(sizeRowKey(row, index)),
      ).length,
    [selectedKeys, visibleRows],
  );
  const allVisibleSelected =
    visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;
  const bulkSelectedCount = selectedKeys.size;

  function selectedRowIndexes() {
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => selectedKeys.has(sizeRowKey(row, index)))
      .map(({ index }) => index);
  }

  function handleAdd() {
    setSelectedIndex(rows.length);
    onAdd();
  }

  function handleRemove(index: number) {
    onRemove(index);
    setSelectedIndex((current) => {
      if (current > index) return current - 1;
      if (current === index) return Math.max(0, current - 1);
      return current;
    });
  }

  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || !onRequestSave) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-size-editor]")) return;
    if (target.tagName === "TEXTAREA") return;
    event.preventDefault();
    if (!canRequestSave || isSaving) {
      toast({
        title: isSaving ? "Save already running" : "Cannot save yet",
        description: isSaving
          ? "Wait for the current save to finish."
          : "Fix the validation footer checks first.",
        variant: "destructive",
      });
      return;
    }
    onRequestSave();
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      return;
    if (!visibleRows.length) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const currentPosition = Math.max(
      0,
      visibleRows.findIndex((item) => item.index === selectedIndex),
    );
    const nextPosition =
      event.key === "ArrowDown"
        ? Math.min(visibleRows.length - 1, currentPosition + 1)
        : Math.max(0, currentPosition - 1);
    setSelectedIndex(visibleRows[nextPosition]?.index ?? selectedIndex);
  }

  function toggleBulkMode() {
    const next = !bulkMode;
    setBulkMode(next);
    if (!next) setSelectedKeys(new Set());
  }

  function toggleRowSelection(
    row: ProductMasterSize,
    index: number,
    checked: boolean,
  ) {
    const key = sizeRowKey(row, index);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const { row, index } of visibleRows) {
        const key = sizeRowKey(row, index);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function applyBulkInactive() {
    const indexes = new Set(selectedRowIndexes());
    if (!indexes.size) return;
    onBulkApply(
      rows.map((row, index) =>
        indexes.has(index) ? { ...row, active: false } : row,
      ),
    );
    toast({
      title: "Selected sizes deactivated",
      description: `${indexes.size} rows updated in draft.`,
    });
  }

  function duplicateSelectedRows() {
    const indexes = selectedRowIndexes();
    if (!indexes.length) return;
    const nextRows = [...rows];
    const duplicateKeys = new Set<string>();
    for (const index of indexes) {
      const source = rows[index];
      if (!source) continue;
      const duplicate = duplicateSizeRow(source, nextRows, nextRows.length + 1);
      nextRows.push(duplicate);
      duplicateKeys.add(sizeRowKey(duplicate, nextRows.length - 1));
    }
    onBulkApply(reindexSizeRows(nextRows));
    setSelectedIndex(rows.length);
    setSelectedKeys(duplicateKeys);
    toast({
      title: "Sizes duplicated",
      description: `${duplicateKeys.size} copy rows added to draft.`,
    });
  }

  function deleteSelectedRows() {
    const keys = selectedKeys;
    if (!keys.size) return;
    const nextRows = rows.filter(
      (row, index) => !keys.has(sizeRowKey(row, index)),
    );
    onBulkApply(reindexSizeRows(nextRows));
    setSelectedKeys(new Set());
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, nextRows.length - 1)));
    toast({
      title: "Selected sizes removed",
      description: `${keys.size} rows deleted from draft.`,
    });
  }

  function duplicateSingleRow(index: number) {
    const source = rows[index];
    if (!source) return;
    const nextRows = [...rows, duplicateSizeRow(source, rows, rows.length + 1)];
    onBulkApply(reindexSizeRows(nextRows));
    setSelectedIndex(rows.length);
    toast({
      title: "Size duplicated",
      description: "Copy row added to the end of the size list.",
    });
  }

  async function downloadTemplate() {
    try {
      const { blob, filename } = await productMasterService.downloadSizeSheet(productId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Size sheet downloaded",
        description:
          "Fill the size columns in Excel (code and label can stay blank — they are made from the size), then upload it back.",
      });
    } catch (error: any) {
      toast({
        title: "Could not download the size sheet",
        description: error?.message || "Save the master first, then try again.",
        variant: "destructive",
      });
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
      toast({
        title: "Upload the size sheet",
        description: "Use the Excel file from Template (.xlsx), or a .csv with the same columns.",
        variant: "destructive",
      });
      return;
    }
    try {
      const { rows: parsed } = await productMasterService.readSizeSheet(productId, file);
      if (!parsed.length) {
        toast({
          title: "No rows found",
          description: "The sheet has column names but no size rows.",
          variant: "destructive",
        });
        return;
      }
      const next = parsed.map((raw, index) => {
        const row = rowFromCsv(
          raw,
          normalizedOutput,
          productId,
          rows.length + index + 1,
        );
        const action: BulkAction = rows.some((existing) =>
          sameCode(existing.code, row.code),
        )
          ? "update"
          : "create";
        return {
          id: `review-${Date.now()}-${index}`,
          action,
          row,
          errors: validateRow(row, normalizedOutput),
          auto: {
            code: !String(raw.code ?? "").trim(),
            label: !String(raw.label ?? "").trim(),
          },
        };
      });
      setReviewRows(withDuplicateErrors(next, normalizedOutput));
      setReviewOpen(true);
      toast({
        title: "Size sheet loaded",
        description: `${next.length} rows ready for review. Nothing is saved until you import and save the master.`,
      });
    } catch (error: any) {
      const detail = error?.response?.data?.file || error?.response?.data?.detail;
      toast({
        title: "Could not read the sheet",
        description: (Array.isArray(detail) ? detail[0] : detail) || error?.message || "Check the file and upload again.",
        variant: "destructive",
      });
    }
  }

  function patchReviewRow(index: number, patch: Partial<ProductMasterSize>) {
    setReviewRows((current) => {
      const next = current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const row = { ...item.row, ...patch };
        const auto = {
          code: Boolean(item.auto?.code) && !("code" in patch),
          label: Boolean(item.auto?.label) && !("label" in patch),
        };
        const standard = standardSizeName(row, normalizedOutput === "ROLL");
        if (standard && auto.code) row.code = standard.code;
        if (standard && auto.label) row.label = standard.label;
        const action: BulkAction = rows.some((existing) =>
          sameCode(existing.code, row.code),
        )
          ? "update"
          : "create";
        return { ...item, row, action, auto };
      });
      return withDuplicateErrors(next, normalizedOutput);
    });
  }

  function confirmBulkImport() {
    const invalidCount = reviewRows.reduce(
      (total, item) => total + item.errors.length,
      0,
    );
    if (invalidCount) {
      toast({
        title: "Fix validation first",
        description: `${invalidCount} issue${invalidCount === 1 ? "" : "s"} still need attention.`,
        variant: "destructive",
      });
      return;
    }
    const merged = mergeRows(
      rows,
      reviewRows.map((item) => {
        if (item.action !== "update" || !item.auto?.label) return item.row;
        // Saved sizes keep their label when the sheet left it blank.
        const saved = rows.find((existing) => sameCode(existing.code, item.row.code));
        return saved ? { ...item.row, label: saved.label } : item.row;
      }),
    );
    onBulkApply(merged);
    setSelectedIndex(Math.max(0, rows.length ? selectedIndex : 0));
    setReviewOpen(false);
    setReviewRows([]);
    toast({
      title: "Sizes imported into draft",
      description: `${merged.length} size rows are now in the editor. Save the master to publish them.`,
    });
  }

  return (
    <div
      className="space-y-4"
      data-testid="product-size-workspace"
      data-output-kind={normalizedOutput}
      onKeyDown={handleWorkspaceKeyDown}
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-success-border bg-success-bg p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-success-fg text-white shadow-sm">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-content-1">
              Compact size workspace
            </div>
            <div className="mt-0.5 text-xs leading-5 text-content-3">
              Left side stays one line per size. Pick a row to edit the full{" "}
              {normalizedOutput.toLowerCase()} geometry on the right.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={downloadTemplate}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Excel sheet
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Bulk upload
          </Button>
          <Button
            type="button"
            size="sm"
            variant={bulkMode ? "default" : "outline"}
            className={cn(
              "rounded-xl",
              bulkMode && "bg-surface-3 text-white hover:bg-line",
            )}
            onClick={toggleBulkMode}
          >
            {bulkMode ? (
              <X className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
            )}
            {bulkMode ? "Exit bulk" : "Bulk mode"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-xl bg-success-fg hover:bg-success-fg"
            onClick={handleAdd}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add size
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-2 p-6 text-center text-sm text-content-3">
          No sizes yet. Add one size manually or import a template file.
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(440px,0.72fr)_minmax(720px,1.6fr)]">
          <div
            className="min-w-0 rounded-2xl border border-line bg-surface-1 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-success-border"
            tabIndex={0}
            onKeyDown={handleListKeyDown}
            aria-label="Size rows. Use arrow keys to move selection."
          >
            <div className="border-b border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-content-3">
                    Size rows
                  </div>
                  <div className="text-sm font-bold text-content-1">
                    {rows.length} total -{" "}
                    {rows.filter((row) => row.active !== false).length} active
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-success-border bg-success-bg px-2.5 text-caption font-bold text-success-fg hover:bg-success-bg"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search code, label, notes..."
                  className="h-9 rounded-xl pl-8 text-xs"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {filterOptions(rows, normalizedOutput).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilterMode(item.value)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-semibold uppercase tracking-wider ring-1 transition",
                      filterMode === item.value
                        ? "bg-success-fg text-white ring-success-border"
                        : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
                    )}
                  >
                    {item.label}
                    <span
                      className={cn(
                        "font-mono",
                        filterMode === item.value
                          ? "text-white/85"
                          : "text-content-4",
                      )}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
              {bulkMode ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <div className="text-xs font-bold text-content-2">
                    {bulkSelectedCount} selected
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs"
                      disabled={!bulkSelectedCount}
                      onClick={applyBulkInactive}
                    >
                      Deactivate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs"
                      disabled={!bulkSelectedCount}
                      onClick={duplicateSelectedRows}
                    >
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      Duplicate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-danger-border text-xs text-danger-fg hover:bg-danger-bg"
                      disabled={!bulkSelectedCount}
                      onClick={deleteSelectedRows}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <ScrollArea className="h-[620px]">
              <div className="min-w-[720px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-2">
                    <TableRow>
                      {bulkMode ? (
                        <TableHead className="w-[42px]">
                          <Checkbox
                            checked={allVisibleSelected}
                            aria-label="Select visible size rows"
                            onCheckedChange={(checked) =>
                              toggleVisibleSelection(checked === true)
                            }
                          />
                        </TableHead>
                      ) : null}
                      <TableHead className="w-[180px] text-caption uppercase tracking-widest">
                        Code
                      </TableHead>
                      <TableHead className="text-caption uppercase tracking-widest">
                        Size
                      </TableHead>
                      <TableHead className="text-caption uppercase tracking-widest">
                        Web
                      </TableHead>
                      <TableHead className="text-caption uppercase tracking-widest">
                        UOM
                      </TableHead>
                      <TableHead className="text-caption uppercase tracking-widest">
                        State
                      </TableHead>
                      <TableHead className="w-[52px] text-right text-caption uppercase tracking-widest"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map(({ row, index }) => {
                      const selected = index === selectedIndex;
                      const geometry = computeProductGeometry(
                        row,
                        normalizedOutput,
                      );
                      const rowKey = sizeRowKey(row, index);
                      const checked = selectedKeys.has(rowKey);
                      return (
                        <TableRow
                          key={rowKey}
                          data-testid={`size-row-${index}`}
                          onClick={() => setSelectedIndex(index)}
                          className={cn(
                            "cursor-pointer transition hover:bg-success-bg",
                            selected &&
                              "bg-success-bg ring-1 ring-inset ring-success-border",
                          )}
                        >
                          {bulkMode ? (
                            <TableCell
                              className="align-top"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Checkbox
                                checked={checked}
                                aria-label={`Select size ${row.code || index + 1}`}
                                onCheckedChange={(value) =>
                                  toggleRowSelection(row, index, value === true)
                                }
                              />
                            </TableCell>
                          ) : null}
                          <TableCell className="align-top">
                            <div className="font-mono text-xs font-semibold text-content-1">
                              {row.code || standardSizeName(row, normalizedOutput === "ROLL")?.code || "New size"}
                            </div>
                            <div className="mt-0.5 truncate text-caption text-content-3">
                              {row.label || standardSizeName(row, normalizedOutput === "ROLL")?.label || "Enter the size"}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="font-mono text-xs font-bold text-content-1">
                              {sizeCopy(row, normalizedOutput)}
                            </div>
                            <div className="mt-0.5 text-caption text-content-3">
                              {summaryCopy(row, normalizedOutput)}
                            </div>
                            <FormulaVersionBadge
                              row={row}
                              outputKind={normalizedOutput}
                              className="mt-1"
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="font-mono text-xs font-semibold text-success-fg">
                              {webWidthCopy(row, normalizedOutput, geometry)}
                            </div>
                            <div className="mt-0.5 text-caption text-content-3">
                              {isOverriddenSize(row, normalizedOutput)
                                ? "override"
                                : "auto/default"}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-semibold text-content-2">
                              {row.qty_uom || "KG"}
                            </span>
                          </TableCell>
                          <TableCell className="align-top">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ring-1",
                                row.active === false
                                  ? "bg-danger-bg text-danger-fg ring-danger-border"
                                  : "bg-success-bg text-success-fg ring-success-border",
                              )}
                            >
                              {row.active === false ? "Inactive" : "Active"}
                            </span>
                          </TableCell>
                          <TableCell
                            className="align-top text-right"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-3 hover:bg-surface-2 hover:text-content-1"
                                  aria-label={`Size row actions for ${row.code || index + 1}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  onSelect={() => duplicateSingleRow(index)}
                                >
                                  <Copy className="h-4 w-4" />
                                  Duplicate row
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-danger-fg focus:text-danger-fg"
                                  onSelect={() => handleRemove(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete row
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {visibleRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={bulkMode ? 7 : 6}
                          className="py-8 text-center text-xs font-medium text-content-3"
                        >
                          No sizes match this search.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </div>

          <div
            className="min-w-0 rounded-2xl border border-line bg-surface-1 p-5 shadow-sm xl:sticky xl:top-4 xl:self-start"
            data-size-editor
          >
            {selectedRow ? (
              <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
                  <div>
                    <div className="text-caption font-semibold uppercase tracking-[0.1em] text-success-fg">
                      Selected size
                    </div>
                    <div className="mt-0.5 font-display text-lg font-semibold text-content-1">
                      {selectedRow.code || `Size ${selectedIndex + 1}`}
                    </div>
                    <div className="text-xs text-content-3">
                      {selectedRow.label || "No label yet"}
                    </div>
                    <FormulaVersionBadge
                      row={selectedRow}
                      outputKind={normalizedOutput}
                      className="mt-2"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex h-9 items-center gap-2 rounded-full bg-surface-2 px-3 text-xs font-semibold text-content-3 ring-1 ring-line">
                      <Switch
                        aria-label="Size active"
                        checked={selectedRow.active !== false}
                        onCheckedChange={(v) =>
                          onPatch(selectedIndex, { active: v })
                        }
                      />
                      {selectedRow.active === false ? "Inactive" : "Active"}
                    </div>
                    <button
                      type="button"
                      onClick={() => duplicateSingleRow(selectedIndex)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-content-3 hover:bg-surface-2"
                      aria-label="Duplicate selected size"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(selectedIndex)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-danger-fg hover:bg-danger-bg"
                      aria-label="Remove selected size"
                      title="Remove selected size"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <LaneUpPreview
                  row={selectedRow}
                  outputKind={normalizedOutput}
                />
                <SizeGeometryEditor
                  row={selectedRow}
                  kind={kind}
                  packagingKind={packagingKind ?? null}
                  fixedFgType={fixedFgType ?? null}
                  onPatch={(patch) => onPatch(selectedIndex, patch)}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-surface-2 p-6 text-center text-sm text-content-3">
                Pick a row from the table to edit.
              </div>
            )}
          </div>
        </div>
      )}

      <BulkReviewDialog
        open={reviewOpen}
        rows={reviewRows}
        outputKind={normalizedOutput}
        onOpenChange={setReviewOpen}
        onPatchRow={patchReviewRow}
        onRemoveRow={(index) =>
          setReviewRows((current) =>
            withDuplicateErrors(
              current.filter((_, itemIndex) => itemIndex !== index),
              normalizedOutput,
            ),
          )
        }
        onConfirm={confirmBulkImport}
      />
    </div>
  );
}

function sizeRowKey(row: ProductMasterSize, index: number) {
  return String(row.id || `${row.code || "size"}-${index}`);
}

function reindexSizeRows(rows: ProductMasterSize[]) {
  return rows.map((row, index) => ({ ...row, sort_order: index + 1 }));
}

function duplicateSizeRow(
  row: ProductMasterSize,
  _existingRows: ProductMasterSize[],
  order: number,
): ProductMasterSize {
  return {
    ...row,
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // A copy is a new size: it is named from its dimensions once they are changed (type to override).
    code: "",
    label: "",
    active: row.active !== false,
    sort_order: order,
  };
}

function uniqueSizeCode(code: string, rows: ProductMasterSize[]) {
  const base = code.endsWith("-COPY") ? code : `${code}-COPY`;
  if (!rows.some((row) => sameCode(row.code, base))) return base;
  let suffix = 2;
  while (rows.some((row) => sameCode(row.code, `${base}-${suffix}`)))
    suffix += 1;
  return `${base}-${suffix}`;
}

function isOverriddenSize(row: ProductMasterSize, outputKind: OutputKind) {
  const childOverride =
    !!row.child_target_override && Number(row.child_target_width_mm || 0) > 0;
  if (childOverride) return true;
  const explicitRollWidth = Number(row.roll_width_mm || 0);
  if (outputKind === "POUCH" && explicitRollWidth > 0) {
    const auto = computeProductGeometry(row, outputKind).fallbackRollWidthMm;
    return Math.abs(explicitRollWidth - auto) > 0.001;
  }
  return (
    outputKind === "ROLL" &&
    explicitRollWidth > 0 &&
    Math.abs(explicitRollWidth - Number(row.width_mm || 0)) > 0.001
  );
}

function filterOptions(
  rows: ProductMasterSize[],
  outputKind: OutputKind,
): Array<{ value: FilterMode; label: string; count: number }> {
  return [
    { value: "all", label: "All", count: rows.length },
    {
      value: "active",
      label: "Active",
      count: rows.filter((row) => row.active !== false).length,
    },
    {
      value: "inactive",
      label: "Inactive",
      count: rows.filter((row) => row.active === false).length,
    },
    {
      value: "overridden",
      label: "Overridden",
      count: rows.filter((row) => isOverriddenSize(row, outputKind)).length,
    },
  ];
}

function formulaVersionInfo(row: ProductMasterSize, outputKind: OutputKind) {
  if (outputKind === "POUCH" && row.pouch_style_master) {
    return {
      label: "Style locked",
      tone: "indigo" as const,
    };
  }
  if (outputKind === "POUCH")
    return { label: "Manual formula", tone: "amber" as const };
  if (outputKind === "ROLL")
    return { label: "Roll geometry", tone: "blue" as const };
  return { label: "No formula", tone: "slate" as const };
}

function FormulaVersionBadge({
  row,
  outputKind,
  className,
}: {
  row: ProductMasterSize;
  outputKind: OutputKind;
  className?: string;
}) {
  const info = formulaVersionInfo(row, outputKind);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ring-1",
        info.tone === "indigo" && "bg-order-bg text-order-fg ring-order-border",
        info.tone === "amber" &&
          "bg-warning-bg text-warning-fg ring-warning-border",
        info.tone === "blue" && "bg-info-bg text-primary ring-info-border",
        info.tone === "slate" && "bg-surface-2 text-content-3 ring-line",
        className,
      )}
    >
      {info.label}
    </span>
  );
}

function LaneUpPreview({
  row,
  outputKind,
}: {
  row: ProductMasterSize;
  outputKind: OutputKind;
}) {
  const baseWidth = finalWebWidthMm(row, outputKind);
  const sourceLabel = isOverriddenSize(row, outputKind)
    ? "Override"
    : outputKind === "POUCH"
      ? "Auto formula"
      : "Roll width";
  if (outputKind !== "POUCH") {
    return (
      <div className="mb-3 rounded-xl border border-info-border bg-info-bg px-3 py-2">
        <div className="text-caption font-semibold uppercase tracking-[0.1em] text-primary">
          Roll width preview
        </div>
        <div className="mt-1 font-mono text-sm font-semibold text-primary">
          {formatMm(baseWidth)} mm
        </div>
      </div>
    );
  }
  const lanes = [1, 2, 3, 4, 5, 6];
  return (
    <div className="mb-3 rounded-xl border border-success-border bg-success-bg px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-caption font-semibold uppercase tracking-[0.1em] text-success-fg">
            Lane-up preview
          </div>
          <div className="mt-0.5 text-caption font-semibold text-content-3">
            {sourceLabel} child web:{" "}
            <span className="font-mono text-content-1">
              {formatMm(baseWidth)} mm
            </span>
          </div>
        </div>
        <FormulaVersionBadge row={row} outputKind={outputKind} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {lanes.map((lane) => (
          <div
            key={lane}
            className="rounded-lg bg-surface-1 px-2 py-1.5 ring-1 ring-success-border"
          >
            <div className="text-caption font-semibold uppercase tracking-wider text-success-fg">
              {lane}-up
            </div>
            <div className="font-mono text-xs font-semibold text-content-1">
              {formatMm(baseWidth * lane)} mm
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function finalWebWidthMm(row: ProductMasterSize, outputKind: OutputKind) {
  if (outputKind === "ROLL") return Number(row.width_mm || 0);
  const geometry = computeProductGeometry(row, outputKind);
  if (row.child_target_override && Number(row.child_target_width_mm || 0) > 0)
    return Number(row.child_target_width_mm || 0);
  if (Number(row.child_target_width_mm || 0) > 0)
    return Number(row.child_target_width_mm || 0);
  return geometry.fallbackRollWidthMm;
}

function formatMm(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Number(value.toFixed(2)).toLocaleString();
}

function BulkReviewDialog({
  open,
  rows,
  outputKind,
  onOpenChange,
  onPatchRow,
  onRemoveRow,
  onConfirm,
}: {
  open: boolean;
  rows: ReviewRow[];
  outputKind: OutputKind;
  onOpenChange: (open: boolean) => void;
  onPatchRow: (index: number, patch: Partial<ProductMasterSize>) => void;
  onRemoveRow: (index: number) => void;
  onConfirm: () => void;
}) {
  const invalidRows = rows.filter((item) => item.errors.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[min(1180px,calc(100vw-2rem))] overflow-hidden p-0">
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <FileSpreadsheet className="h-5 w-5 text-success-fg" />
            Review size import
          </DialogTitle>
          <DialogDescription>
            Edit rows here before import. Nothing is saved to the backend until
            the Product Master is saved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 border-b border-line bg-surface-2 px-5 py-3 text-xs sm:grid-cols-3">
          <ReviewStat label="Rows" value={rows.length} tone="slate" />
          <ReviewStat
            label="New"
            value={rows.filter((item) => item.action === "create").length}
            tone="emerald"
          />
          <ReviewStat
            label="Issues"
            value={invalidRows.length}
            tone={invalidRows.length ? "rose" : "emerald"}
          />
        </div>
        <ScrollArea className="h-[52vh]">
          <div className="min-w-[1120px] p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[86px]">Action</TableHead>
                  <TableHead className="w-[150px]">Code</TableHead>
                  <TableHead className="w-[190px]">Label</TableHead>
                  <TableHead className="w-[120px]">
                    {outputKind === "ROLL" ? "Roll width" : "Width"}
                  </TableHead>
                  {outputKind === "POUCH" ? (
                    <TableHead className="w-[120px]">Height</TableHead>
                  ) : null}
                  {outputKind === "POUCH" ? (
                    <TableHead className="w-[120px]">Gusset</TableHead>
                  ) : null}
                  {outputKind === "ROLL" ? (
                    <TableHead className="w-[130px]">Roll form</TableHead>
                  ) : null}
                  <TableHead className="w-[120px]">Std qty</TableHead>
                  <TableHead className="w-[110px]">UOM</TableHead>
                  <TableHead className="w-[150px]">Status</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item, index) => (
                  <TableRow
                    key={item.id}
                    className={item.errors.length ? "bg-danger-bg" : ""}
                  >
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-caption font-semibold uppercase ring-1",
                          item.action === "update"
                            ? "bg-info-bg text-primary ring-info-border"
                            : "bg-success-bg text-success-fg ring-success-border",
                        )}
                      >
                        {item.action}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.auto?.code ? <div className="mb-0.5 text-[10.5px] font-semibold text-success-fg">auto from size</div> : null}
                      <Input
                        aria-label={`Size ${index + 1} code`}
                        className="h-8 font-mono text-xs"
                        value={item.row.code || ""}
                        onChange={(event) =>
                          onPatchRow(index, {
                            code: event.target.value.toUpperCase(),
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {item.auto?.label ? <div className="mb-0.5 text-[10.5px] font-semibold text-success-fg">auto from size</div> : null}
                      <Input
                        aria-label={`Size ${index + 1} label`}
                        className="h-8 text-xs"
                        value={item.row.label || ""}
                        onChange={(event) =>
                          onPatchRow(index, { label: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Size ${index + 1} width mm`}
                        type="number"
                        step="any"
                        className="h-8 text-right font-mono text-xs"
                        value={numericValue(item.row.width_mm)}
                        onChange={(event) =>
                          onPatchRow(index, {
                            width_mm: numberOrNull(event.target.value) as any,
                          })
                        }
                      />
                    </TableCell>
                    {outputKind === "POUCH" ? (
                      <TableCell>
                        <Input
                          aria-label={`Size ${index + 1} height mm`}
                          type="number"
                          step="any"
                          className="h-8 text-right font-mono text-xs"
                          value={numericValue(item.row.height_mm)}
                          onChange={(event) =>
                            onPatchRow(index, {
                              height_mm: numberOrNull(
                                event.target.value,
                              ) as any,
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    {outputKind === "POUCH" ? (
                      <TableCell>
                        <Input
                          aria-label={`Size ${index + 1} gusset mm`}
                          type="number"
                          step="any"
                          className="h-8 text-right font-mono text-xs"
                          value={numericValue(item.row.gusset_mm)}
                          onChange={(event) =>
                            onPatchRow(index, {
                              gusset_mm: numberOrNull(
                                event.target.value,
                              ) as any,
                            })
                          }
                        />
                      </TableCell>
                    ) : null}
                    {outputKind === "ROLL" ? (
                      <TableCell>
                        <Select
                          value={String(
                            item.row.roll_form || "FLAT",
                          ).toUpperCase()}
                          onValueChange={(value) =>
                            onPatchRow(index, { roll_form: value })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label={`Size ${index + 1} roll form`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FLAT">FLAT</SelectItem>
                            <SelectItem value="FOLDED">FOLDED</SelectItem>
                            <SelectItem value="TUBING">TUBING</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Input
                        aria-label={`Size ${index + 1} standard quantity`}
                        type="number"
                        step="any"
                        className="h-8 text-right font-mono text-xs"
                        value={numericValue(item.row.standard_qty)}
                        onChange={(event) =>
                          onPatchRow(index, {
                            standard_qty: numberOrNull(
                              event.target.value,
                            ) as any,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={String(item.row.qty_uom || "KG").toUpperCase()}
                        onValueChange={(value) =>
                          onPatchRow(index, { qty_uom: value as any })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label={`Size ${index + 1} quantity unit`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COMMON_UOMS.map((uom) => (
                            <SelectItem key={uom} value={uom}>
                              {uom}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {item.errors.length ? (
                        <div className="flex items-start gap-1.5 text-caption font-semibold leading-4 text-danger-fg">
                          <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" />
                          <span>{item.errors.join(", ")}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-caption font-semibold uppercase text-success-fg">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
                        onClick={() => onRemoveRow(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-content-3"
                    >
                      No rows left to import.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
        <DialogFooter className="border-t border-line px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-success-fg hover:bg-success-fg"
            disabled={!rows.length || invalidRows.length > 0}
            onClick={onConfirm}
          >
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 ring-1",
        tone === "slate" && "bg-surface-1 text-content-2 ring-line",
        tone === "emerald" &&
          "bg-success-bg text-success-fg ring-success-border",
        tone === "rose" && "bg-danger-bg text-danger-fg ring-danger-border",
      )}
    >
      <div className="text-caption font-semibold uppercase tracking-widest opacity-70">
        {label}
      </div>
      <div className="font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function sampleRow(
  outputKind: OutputKind,
  order: number,
): Record<string, string | number | boolean> {
  if (outputKind === "ROLL") {
    return {
      code: "500",
      label: "500 mm web",
      width_mm: 500,
      roll_form: "FLAT",
      trim_loss_mm: 0,
      trim_apply_to: "NONE",
      roll_width_mm: "",
      stock_form: "OPEN_WEB",
      width_basis: "OPEN_WEB_WIDTH",
      film_area_width_mm: 500,
      slit_policy: "SLIT_ALLOWED",
      thickness_micron: "",
      standard_qty: "",
      qty_uom: "KG",
      active: true,
      sort_order: order,
      notes: "",
    };
  }
  return {
    code: "250X350",
    label: "250 × 350 mm",
    width_mm: 250,
    height_mm: 350,
    pouch_style_master: "",
    pouch_style: "PILLOW",
    gusset_mm: 0,
    flap_tape_mm: 0,
    trim_loss_mm: 10,
    trim_apply_to: "WIDTH",
    stock_form: "OPEN_WEB",
    width_basis: "OPEN_WEB_WIDTH",
    film_area_width_mm: "",
    slit_policy: "SLIT_ALLOWED",
    roll_width_mm: "",
    child_target_width_mm: "",
    child_target_override: false,
    standard_qty: "",
    qty_uom: "KG",
    active: true,
    sort_order: order,
    notes: "",
  };
}

function rowFromCsv(
  raw: Record<string, string>,
  outputKind: OutputKind,
  productId: string,
  order: number,
): ProductMasterSize {
  const base = sampleRow(outputKind, order);
  const value = (key: string) =>
    raw[key] ?? raw[key.toUpperCase()] ?? raw[key.replaceAll("_", " ")] ?? "";
  const defaulted = (key: string, fallback: unknown) => {
    const current = value(key);
    return current === "" || current === null || current === undefined
      ? fallback
      : current;
  };
  const row: ProductMasterSize = {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product_master: productId,
    code: String(value("code")).trim().toUpperCase(),
    label: String(value("label")).trim(),
    width_mm: numberOrZero(value("width_mm")),
    height_mm: outputKind === "ROLL" ? 0 : numberOrZero(value("height_mm")),
    gusset_mm:
      outputKind === "ROLL"
        ? 0
        : numberOrZero(defaulted("gusset_mm", base.gusset_mm)),
    roll_width_mm: numberOrNull(value("roll_width_mm")) as any,
    thickness_micron: numberOrNull(value("thickness_micron")) as any,
    standard_qty: numberOrNull(value("standard_qty")) as any,
    qty_uom: String(defaulted("qty_uom", base.qty_uom || "KG"))
      .trim()
      .toUpperCase() as any,
    pouch_style:
      outputKind === "ROLL"
        ? ""
        : String(defaulted("pouch_style", base.pouch_style || "PILLOW"))
            .trim()
            .toUpperCase(),
    pouch_style_master:
      outputKind === "ROLL"
        ? null
        : String(value("pouch_style_master") || "").trim() || null,
    pouch_style_version: outputKind === "ROLL" ? 0 : 1,
    roll_form:
      outputKind === "ROLL"
        ? String(defaulted("roll_form", base.roll_form || "FLAT"))
            .trim()
            .toUpperCase()
        : "",
    stock_form: String(defaulted("stock_form", base.stock_form || "OPEN_WEB"))
      .trim()
      .toUpperCase(),
    width_basis: String(
      defaulted("width_basis", base.width_basis || "OPEN_WEB_WIDTH"),
    )
      .trim()
      .toUpperCase(),
    film_area_width_mm: numberOrNull(value("film_area_width_mm")) as any,
    slit_policy: String(
      defaulted("slit_policy", base.slit_policy || "SLIT_ALLOWED"),
    )
      .trim()
      .toUpperCase(),
    trim_loss_mm: numberOrZero(defaulted("trim_loss_mm", base.trim_loss_mm)),
    trim_apply_to: normalizeImpact(
      defaulted("trim_apply_to", base.trim_apply_to),
    ),
    flap_tape_mm:
      outputKind === "ROLL"
        ? 0
        : numberOrZero(defaulted("flap_tape_mm", base.flap_tape_mm)),
    gusset_apply_to:
      outputKind === "ROLL"
        ? "NONE"
        : normalizeImpact(defaulted("gusset_apply_to", "HEIGHT")),
    gusset_factor:
      outputKind === "ROLL" ? 0 : numberOrZero(defaulted("gusset_factor", 1)),
    child_target_width_mm:
      outputKind === "ROLL"
        ? null
        : (numberOrNull(value("child_target_width_mm")) as any),
    child_target_override:
      outputKind === "ROLL" ? false : boolValue(value("child_target_override")),
    adjustments: [],
    geometry_config:
      outputKind === "ROLL"
        ? {
            roll_form: String(defaulted("roll_form", base.roll_form || "FLAT"))
              .trim()
              .toUpperCase(),
            trim_loss_mm: numberOrZero(
              defaulted("trim_loss_mm", base.trim_loss_mm),
            ),
            trim_apply_to: normalizeImpact(
              defaulted("trim_apply_to", base.trim_apply_to),
            ),
            adjustments: [],
          }
        : {
            pouch_style: String(
              defaulted("pouch_style", base.pouch_style || "PILLOW"),
            )
              .trim()
              .toUpperCase(),
            trim_loss_mm: numberOrZero(
              defaulted("trim_loss_mm", base.trim_loss_mm),
            ),
            trim_apply_to: normalizeImpact(
              defaulted("trim_apply_to", base.trim_apply_to),
            ),
            flap_tape_mm: numberOrZero(
              defaulted("flap_tape_mm", base.flap_tape_mm),
            ),
            gusset_apply_to: normalizeImpact(
              defaulted("gusset_apply_to", "HEIGHT"),
            ),
            gusset_factor: numberOrZero(defaulted("gusset_factor", 1)),
            adjustments: [],
          },
    notes: String(value("notes") || "").trim(),
    active: value("active") === "" ? true : boolValue(value("active")),
    sort_order: numberOrZero(defaulted("sort_order", order)),
  };
  // Rows left without a code or label get the standard name from their dimensions.
  const standard = standardSizeName(row, outputKind === "ROLL");
  if (standard && !row.code) row.code = standard.code;
  if (standard && !String(row.label || "").trim()) row.label = standard.label;
  return row;
}

function validateRow(row: ProductMasterSize, outputKind: OutputKind): string[] {
  const errors: string[] = [];
  // Code and label come from the dimensions when left blank; only a row with neither needs them.
  const standard = standardSizeName(row, outputKind === "ROLL");
  if (!String(row.code || "").trim() && !standard) errors.push("code or size required");
  if (Number(row.width_mm || 0) <= 0)
    errors.push(
      outputKind === "ROLL" ? "roll width required" : "width required",
    );
  if (outputKind === "POUCH" && Number(row.height_mm || 0) <= 0)
    errors.push("height required");
  if (!COMMON_UOMS.includes(String(row.qty_uom || "KG").toUpperCase() as any))
    errors.push("bad uom");
  if (
    outputKind === "ROLL" &&
    !["FLAT", "FOLDED", "TUBING"].includes(
      String(row.roll_form || "").toUpperCase(),
    )
  )
    errors.push("bad roll form");
  return errors;
}

function withDuplicateErrors(rows: ReviewRow[], outputKind: OutputKind) {
  const counts = new Map<string, number>();
  for (const item of rows) {
    const key = String(item.row.code || "")
      .trim()
      .toUpperCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.map((item) => {
    const base = validateRow(item.row, outputKind);
    const key = String(item.row.code || "")
      .trim()
      .toUpperCase();
    if (key && (counts.get(key) || 0) > 1)
      base.push("duplicate code in upload");
    return { ...item, errors: base };
  });
}

function mergeRows(
  existing: ProductMasterSize[],
  incoming: ProductMasterSize[],
) {
  const next = [...existing];
  for (const row of incoming) {
    const index = next.findIndex((existingRow) =>
      sameCode(existingRow.code, row.code),
    );
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...row,
        id: next[index].id,
        product_master: next[index].product_master,
      };
    } else {
      next.push(row);
    }
  }
  return next.map((row, index) => ({
    ...row,
    sort_order: row.sort_order || index + 1,
  }));
}



function sameCode(a: unknown, b: unknown) {
  return (
    String(a || "")
      .trim()
      .toUpperCase() ===
    String(b || "")
      .trim()
      .toUpperCase()
  );
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericValue(value: unknown) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function boolValue(value: unknown) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return false;
  return ["1", "true", "yes", "y", "active"].includes(text);
}

function normalizeImpact(value: unknown) {
  const text = String(value || "WIDTH")
    .trim()
    .toUpperCase();
  return ["WIDTH", "HEIGHT", "BOTH", "NONE"].includes(text)
    ? (text as any)
    : "WIDTH";
}

function sizeCopy(row: ProductMasterSize, outputKind: OutputKind) {
  if (outputKind === "ROLL")
    return mmWithInches(row.width_mm) || "0 mm";
  return mmWithInches(row.width_mm, row.height_mm) || `${Number(row.width_mm || 0).toLocaleString()} x ${Number(row.height_mm || 0).toLocaleString()}`;
}

function summaryCopy(row: ProductMasterSize, outputKind: OutputKind) {
  if (outputKind === "ROLL")
    return `${String(row.roll_form || "FLAT").replaceAll("_", " ")} roll`;
  const style = row.pouch_style_master
    ? "style master"
    : String(row.pouch_style || "manual").replaceAll("_", " ");
  return `${style}${Number(row.gusset_mm || 0) > 0 ? ` - G ${row.gusset_mm}` : ""}`;
}

function webWidthCopy(
  row: ProductMasterSize,
  outputKind: OutputKind,
  geometry: ReturnType<typeof computeProductGeometry>,
) {
  if (outputKind === "ROLL")
    return mmWithInches(row.width_mm) || "0 mm";
  const child = Number(row.child_target_width_mm || 0);
  const width = child > 0 ? child : geometry.fallbackRollWidthMm;
  return width > 0 ? `${Number(width.toFixed(2)).toLocaleString()} mm` : "-";
}
