"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Link2, Loader2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { productMasterService } from "@/services/product-master";
import { cn } from "@/lib/utils";

export interface CatalogLinkRow {
  id: string;
  code: string;
  name?: string;
  product_master_link?: {
    master_id: string;
    master_code: string;
    master_name: string;
    variant_id: string;
    variant_code: string;
  } | null;
}

/**
 * The "made by" link of one catalog row (POD roll or in-house packaging), shown
 * on its master card. Linking is one step: pick the Product Master and size; the
 * variant is found or made and the row linked to it.
 */
export function CatalogLinkPanel({
  row,
  linkable,
  kindLabel,
  invalidateKeys,
}: {
  row: CatalogLinkRow;
  /** False for bought-only rows: they show their state but offer no link. */
  linkable: boolean;
  kindLabel: string;
  invalidateKeys: string[][];
}) {
  const link = row.product_master_link || null;
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = () => {
    for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["product-master-variants"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-link-options", row.id] });
  };

  const unlink = useMutation({
    mutationFn: () =>
      productMasterService.linkVariantInventory(link!.master_id, link!.variant_id, null),
    onSuccess: () => {
      toast({ title: "Link removed", description: `${row.code} is no longer made by ${link?.master_code}.` });
      refresh();
    },
    onError: (err: any) =>
      toast({
        title: "Could not remove the link",
        description: err?.response?.data?.error || err?.message || "Try again",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-semibold text-content-3">Made by Product Master</div>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1",
          link
            ? "bg-success-bg text-success-fg ring-success-border"
            : linkable
              ? "bg-warning-bg text-warning-fg ring-warning-border"
              : "bg-surface-1 text-content-2 ring-line",
        )}
      >
        {link ? (
          <div className="min-w-0">
            <Link
              href={`/master/products/${link.master_id}`}
              className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
            >
              {link.master_code} · {link.master_name}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <div className="mt-0.5 truncate font-mono text-caption font-bold">{link.variant_code}</div>
          </div>
        ) : (
          <span className="font-semibold">
            {linkable ? `Not linked yet: link the ${kindLabel} master that makes it.` : "Bought in: no Product Master link needed."}
          </span>
        )}
        {linkable ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant={link ? "outline" : "default"} onClick={() => setOpen(true)}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {link ? "Change" : "Link to Product Master"}
            </Button>
            {link ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => unlink.mutate()}
                disabled={unlink.isPending}
                aria-label={`Remove the Product Master link of ${row.code}`}
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <CatalogLinkDialog row={row} kindLabel={kindLabel} open={open} onOpenChange={setOpen} onLinked={refresh} />
      ) : null}
    </div>
  );
}

export function CatalogLinkDialog({
  row,
  kindLabel,
  open,
  onOpenChange,
  onLinked,
  presetMasterId,
}: {
  row: CatalogLinkRow;
  kindLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: () => void;
  presetMasterId?: string;
}) {
  const { toast } = useToast();
  const options = useQuery({
    queryKey: ["catalog-link-options", row.id],
    queryFn: () => productMasterService.catalogLinkOptions(row.id),
    enabled: open,
    staleTime: 30_000,
  });
  const masters = options.data?.masters || [];
  const [masterId, setMasterId] = React.useState(presetMasterId || "");
  const [size, setSize] = React.useState("");
  React.useEffect(() => {
    if (!masterId && masters.length) setMasterId(options.data?.linked?.master_id || masters[0].id);
  }, [masterId, masters, options.data?.linked?.master_id]);
  const master = masters.find((m) => m.id === masterId);
  React.useEffect(() => {
    setSize(master?.sizes[0]?.code || "");
  }, [master?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkMut = useMutation({
    mutationFn: () => productMasterService.linkCatalog(masterId, row.id, size),
    onSuccess: (data) => {
      toast({
        title: "Linked",
        description: `${row.code} is made by ${master?.code} · ${data.variant.code}${data.variant_created ? " (new variant)" : ""}.`,
      });
      onLinked?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      const detail = err?.response?.data;
      toast({
        title: "Could not link",
        description:
          detail?.error ||
          (detail && typeof detail === "object" ? Object.values(detail).flat().join(" ") : "") ||
          err?.message ||
          "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Link <span className="font-mono text-order-fg">{row.code}</span> to the master that makes it
          </DialogTitle>
          <DialogDescription className="text-caption">
            Pick the {kindLabel} Product Master and the size it is made in. The matching variant is found or made, and
            in-house demand for {row.code} then plans from that master.
          </DialogDescription>
        </DialogHeader>
        {options.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-content-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading masters…
          </div>
        ) : options.isError ? (
          <div className="rounded-xl bg-danger-bg p-3 text-sm text-danger-fg ring-1 ring-danger-border">
            {(options.error as any)?.response?.data?.error || "Could not load the masters."}
          </div>
        ) : !masters.length ? (
          <div className="space-y-2 rounded-xl border border-dashed border-line bg-surface-2 p-4 text-sm text-content-2">
            <p>No active {kindLabel} Product Master yet.</p>
            <Link
              href={`/master/products?kind=${options.data?.product_kind || "POD"}`}
              className="inline-flex items-center gap-1 font-semibold text-order-fg underline-offset-2 hover:underline"
            >
              Create one in Product Master <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-semibold text-content-3">Product Master</legend>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {masters.map((m) => (
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2 ring-1",
                      m.id === masterId ? "bg-order-bg ring-order-border" : "bg-surface-1 ring-line hover:bg-surface-2",
                    )}
                  >
                    <input
                      type="radio"
                      name={`catalog-link-master-${row.id}`}
                      className="mt-1"
                      checked={m.id === masterId}
                      onChange={() => setMasterId(m.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-content-1">{m.name}</span>
                      <span className="block font-mono text-caption text-content-3">
                        {m.code} · {m.sizes.length} size{m.sizes.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor={`catalog-link-size-${row.id}`} className="text-[12px] font-semibold text-content-3">
                Size it is made in
              </label>
              <select
                id={`catalog-link-size-${row.id}`}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface-1 px-3 text-sm text-content-1"
              >
                {(master?.sizes || []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                    {s.label && s.label !== s.code ? ` · ${s.label}` : ""}
                  </option>
                ))}
                {!master?.sizes.length ? <option value="">Master default</option> : null}
              </select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => linkMut.mutate()} disabled={!masterId || linkMut.isPending || !masters.length}>
            {linkMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
