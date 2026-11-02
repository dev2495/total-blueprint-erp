"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Lock, AlertTriangle, Sparkles } from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  pouchStyleService,
  FORMULA_KIND_LABELS,
  type PouchStyle,
} from "@/services/pouch-style";

export default function PouchStylesListPage() {
  return (
    <React.Suspense fallback={null}>
      <StylesList />
    </React.Suspense>
  );
}

function StylesList() {
  const [q, setQ] = React.useState("");
  const [showDisabled, setShowDisabled] = React.useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  // One page, two tabs: pouch styles (formula) and roll styles (form + fold). ?tab=roll opens roll styles.
  const kind: "POUCH" | "ROLL" = String(searchParams?.get("tab") || "").toLowerCase() === "roll" ? "ROLL" : "POUCH";
  const setKind = (next: "POUCH" | "ROLL") =>
    router.replace(next === "ROLL" ? "/master/pouch-styles?tab=roll" : "/master/pouch-styles");
  const { data: styles = [], isLoading } = useQuery({
    queryKey: ["pouch-styles"],
    queryFn: () => pouchStyleService.list({ page_size: 200 }),
    staleTime: 30_000,
  });

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = styles;
    if (!showDisabled) rows = rows.filter((s) => !s.deprecated);
    rows = rows.filter((s) => styleFor(s) === kind);
    if (!needle) return rows;
    return rows.filter((s) =>
      [s.code, s.name, s.description, s.formula_kind]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [styles, q, showDisabled, kind]);

  const tabStyles = styles.filter((s) => styleFor(s) === kind);
  const lockedCount = tabStyles.filter((s) => s.locked).length;
  const disabledCount = tabStyles.filter((s) => s.deprecated).length;
  const usedSum = tabStyles.reduce((sum, s) => sum + (s.sizes_count || 0), 0);
  const countFor = (value: "POUCH" | "ROLL") =>
    styles.filter((s) => styleFor(s) === value && (showDisabled || !s.deprecated)).length;

  return (
    <div className="min-h-screen bg-surface-2 px-4 py-4 sm:px-6">
      <GradientHero
        palette="indigo"
        eyebrow="MASTER · STYLES"
        title={kind === "ROLL" ? "Roll forms + folds" : "Pouch shapes + formulas"}
        subtitle={
          kind === "ROLL"
            ? "A roll style sets a roll size's form (open, folded or tube) and its fold: flap, seal and fold trim. The folding step reads it."
            : "Each style declares the allowed size fields, the child stock-width formula, and the film-area formula used for BOM, costing, and roll allocation."
        }
        chips={[
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: "Styles",
            value: String(tabStyles.length),
            tone: "violet",
          },
          {
            icon: <Lock className="h-4 w-4" />,
            label: "Locked",
            value: String(lockedCount),
            tone: "info",
          },
          {
            icon: <Sparkles className="h-4 w-4" />,
            label: "Used by sizes",
            value: String(usedSum),
            tone: "ok",
          },
        ]}
        actions={
          <Link href={kind === "ROLL" ? "/master/pouch-styles/new?for=roll" : "/master/pouch-styles/new"}>
            <Button className="bg-surface-1 text-order-fg hover:bg-surface-1/90">
              <Plus className="mr-1.5 h-4 w-4" /> {kind === "ROLL" ? "New roll style" : "New pouch style"}
            </Button>
          </Link>
        }
      />

      <div className="mt-4 flex gap-1 border-b border-line" role="tablist" data-testid="style-kind-tabs">
        {(["POUCH", "ROLL"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-semibold",
              kind === value
                ? "border-order-fg text-order-fg"
                : "border-transparent text-content-3 hover:text-content-1",
            )}
          >
            {value === "POUCH" ? "Pouch styles" : "Roll styles"}{" "}
            <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-caption text-content-3">{countFor(value)}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, name or formula…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3 text-[12px] text-content-3">
          <label className="flex items-center gap-1.5 text-caption font-bold">
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
            />
            Show disabled ({disabledCount})
          </label>
          <span>
            Showing <b className="text-content-1">{filtered.length}</b> of{" "}
            {tabStyles.length}
          </span>
        </div>
      </div>

      <section className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-content-3">
            Loading pouch styles…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="text-3xl">{kind === "ROLL" ? "🧻" : "🛍️"}</div>
            <div>
              <div className="text-sm font-bold text-content-2">
                {tabStyles.length === 0
                  ? kind === "ROLL"
                    ? "No roll styles yet"
                    : "No pouch styles yet"
                  : "No styles match your search"}
              </div>
              <p className="mt-1 max-w-[420px] text-caption text-content-3">
                {tabStyles.length === 0
                  ? kind === "ROLL"
                    ? "A roll style is a named form and fold, e.g. J-fold with a 20 mm flap or a sealed tube. Roll sizes pick it to get their form and fold in one go."
                    : "Build your first pouch style from scratch — pick the fields you need (W, H, gusset, flap…), set how each affects the roll width, save."
                  : "Try a different search term or clear the filter."}
              </p>
            </div>
            {tabStyles.length === 0 ? (
              <Link href={kind === "ROLL" ? "/master/pouch-styles/new?for=roll" : "/master/pouch-styles/new"}>
                <Button className="bg-order-fg text-white hover:bg-order-fg">
                  <Plus className="mr-1.5 h-4 w-4" /> {kind === "ROLL" ? "Build first roll style" : "Build first pouch style"}
                </Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-left text-[12px] font-semibold text-content-3">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Formula</th>
                <th className="px-4 py-2">Stock form</th>
                <th className="px-4 py-2">Area formula</th>
                <th className="px-4 py-2">Slit</th>
                <th className="px-4 py-2">Sizes</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((s) => (
                <PouchRow key={s.id} s={s} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function PouchRow({ s }: { s: PouchStyle }) {
  return (
    <tr className="hover:bg-order-bg">
      <td className="px-4 py-2 font-mono font-bold text-order-fg">
        <span className="mr-1.5">{s.visual_emoji}</span>
        {s.code}
      </td>
      <td className="px-4 py-2">
        {s.name}
        {styleFor(s) === "ROLL" ? (
          <Badge variant="outline" className="ml-1.5 border-line bg-surface-2 text-caption text-content-2">
            roll style
          </Badge>
        ) : null}
      </td>
      <td className="px-4 py-2">
        {styleFor(s) === "ROLL" ? (
          <span className="text-caption text-content-3">Roll width = size width</span>
        ) : (
          <>
            <span className="font-mono text-caption text-content-2">
              {s.formula_kind}
            </span>
            <div className="text-caption text-content-4">
              {s.formula_expression || FORMULA_KIND_LABELS[s.formula_kind]}
            </div>
          </>
        )}
      </td>
      <td className="px-4 py-2">
        <Badge
          variant="outline"
          className="border-info-border bg-info-bg text-caption text-primary"
        >
          {stockFormLabel(s.default_stock_form)}
        </Badge>
      </td>
      <td className="px-4 py-2 text-caption text-content-3">
        {areaFormulaLabel(s)}
      </td>
      <td className="px-4 py-2 text-caption font-bold text-content-3">
        {s.default_slit_policy === "EXACT_ONLY" ? "Exact only" : "Allowed"}
      </td>
      <td className="px-4 py-2">{s.sizes_count ?? 0}</td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {s.deprecated ? (
            <Badge
              variant="outline"
              className="border-danger-border bg-danger-bg text-caption text-danger-fg"
            >
              disabled
            </Badge>
          ) : s.locked ? (
            <Badge
              variant="outline"
              className="border-success-border bg-success-bg text-caption text-success-fg"
            >
              <Lock className="mr-0.5 h-2.5 w-2.5" /> locked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-warning-border bg-warning-bg text-caption text-warning-fg"
            >
              draft
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          href={`/master/pouch-styles/${s.id}`}
          className={cn(
            "inline-flex items-center rounded-lg px-2.5 py-1 text-caption font-bold",
            "bg-order-fg text-white hover:bg-order-fg",
          )}
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

function styleFor(style: PouchStyle): "POUCH" | "ROLL" {
  return String(style.style_for || "POUCH").toUpperCase() === "ROLL" ? "ROLL" : "POUCH";
}

function stockFormLabel(value?: string) {
  if (value === "LAYFLAT_TUBE") return "Tube";
  if (value === "FOLDED_WEB") return "Folded";
  return "Open web";
}

function areaFormulaLabel(style: PouchStyle) {
  const form = String(style.default_stock_form || "OPEN_WEB").toUpperCase();
  const option =
    style.stock_form_options && typeof style.stock_form_options === "object"
      ? (style.stock_form_options as Record<string, any>)[form]
      : null;
  const folded = form === "LAYFLAT_TUBE" || form === "FOLDED_WEB";
  const fallback = folded ? 2 : 1;
  const factor = Number(option?.film_area_factor || fallback);
  const flap = Number(option?.flap_mm || 0);
  const seal = Number(option?.seal_mm || 0);
  const extra = folded && flap + seal > 0 ? ` + ${flap + seal}` : "";
  return `area = child × ${Number.isFinite(factor) ? factor : fallback}${extra} × pitch`;
}
