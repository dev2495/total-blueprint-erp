"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Loader2,
  PackageCheck,
  Plus,
  Truck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  customerDispatchApi,
  type CustomerDispatch,
} from "@/services/customer-dispatch";

const STATUS_TONE: Record<CustomerDispatch["status"], string> = {
  DRAFT: "border-line-strong bg-surface-2 text-content-2",
  CONFIRMED: "border-info-border bg-info-bg text-primary",
  DISPATCHED: "border-success-border bg-success-bg text-success-fg",
  CANCELLED: "border-danger-border bg-danger-bg text-danger-fg",
};

export default function SalesOrderDispatchesPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["customer-dispatches", orderId],
    queryFn: () => customerDispatchApi.list({ sales_order: orderId }),
    enabled: !!orderId,
    staleTime: 15_000,
  });

  const rows = listQuery.data ?? [];

  const confirmMutation = useMutation({
    mutationFn: (id: string) => customerDispatchApi.confirm(id),
    onSuccess: (dispatch) => {
      toast({
        title: "Dispatch confirmed",
        description: `${dispatch.code} now CONFIRMED`,
      });
      queryClient.invalidateQueries({
        queryKey: ["customer-dispatches", orderId],
      });
    },
    onError: (err) =>
      toast({
        title: "Confirm failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => customerDispatchApi.cancel(id),
    onSuccess: () => {
      toast({ title: "Dispatch cancelled" });
      queryClient.invalidateQueries({
        queryKey: ["customer-dispatches", orderId],
      });
    },
    onError: (err) =>
      toast({
        title: "Cancel failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const totals = useMemo(() => {
    const confirmed = rows.filter(
      (r) => r.status === "CONFIRMED" || r.status === "DISPATCHED",
    ).length;
    const draft = rows.filter((r) => r.status === "DRAFT").length;
    return { total: rows.length, confirmed, draft };
  }, [rows]);

  if (!orderId) {
    return <div className="p-8 text-sm text-content-3">Missing order id.</div>;
  }

  return (
    <div className="min-h-screen space-y-6 bg-surface-2 p-6">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-primary via-primary to-surface-3 px-8 py-7 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href={`/sales/orders/${orderId}`}
              className="inline-flex items-center gap-1 rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/90 hover:bg-surface-1/20"
            >
              <ArrowLeft className="h-3 w-3" /> Back to order
            </Link>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              Customer dispatches
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-info-border">
              Each dispatch consumes the open qty on the sales order lines. Once
              every line is fully dispatched, the order auto-flips to{" "}
              <span className="font-bold text-white">COMPLETED</span>.
            </p>
          </div>
          <Button
            asChild
            className="rounded-full bg-surface-1 text-primary hover:bg-info-bg"
          >
            <Link href={`/sales/orders/${orderId}/dispatches/new`}>
              <Plus className="mr-2 h-4 w-4" /> New dispatch
            </Link>
          </Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatPill
          icon={<Truck className="h-4 w-4" />}
          label="Total dispatches"
          value={String(totals.total)}
        />
        <StatPill
          icon={<BadgeCheck className="h-4 w-4" />}
          label="Confirmed / shipped"
          value={String(totals.confirmed)}
          tone="ok"
        />
        <StatPill
          icon={<PackageCheck className="h-4 w-4" />}
          label="Drafts in progress"
          value={String(totals.draft)}
          tone="warn"
        />
      </div>

      <Card className="border-line">
        <CardHeader>
          <CardTitle className="text-lg font-black text-content-1">
            Dispatch ledger
          </CardTitle>
          <CardDescription>
            Every dispatch raised against this sales order, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-content-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="space-y-3 p-8 text-center text-sm text-content-3">
              <div className="font-semibold text-content-2">
                No dispatches yet.
              </div>
              <div>Create the first dispatch to start shipping this order.</div>
              <Button asChild className="rounded-full">
                <Link href={`/sales/orders/${orderId}/dispatches/new`}>
                  <Plus className="mr-2 h-4 w-4" /> New dispatch
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-content-1">
                          {row.code}
                        </span>
                        <Badge
                          variant="outline"
                          className={`rounded-full text-[10px] font-bold uppercase ${STATUS_TONE[row.status]}`}
                        >
                          {row.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-content-3">
                        Dispatch date {row.dispatch_date} · {row.lines.length}{" "}
                        line{row.lines.length === 1 ? "" : "s"}
                        {row.vehicle_no ? ` · Vehicle ${row.vehicle_no}` : ""}
                        {row.lr_no ? ` · LR ${row.lr_no}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.status === "DRAFT" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-full"
                            onClick={() => cancelMutation.mutate(row.id)}
                            disabled={cancelMutation.isPending}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 rounded-full bg-primary text-white hover:bg-primary"
                            onClick={() => confirmMutation.mutate(row.id)}
                            disabled={confirmMutation.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{" "}
                            Confirm
                          </Button>
                        </>
                      ) : null}
                      <Link
                        href={`/sales/orders/${orderId}/dispatches/${row.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold text-content-2 hover:bg-surface-2"
                      >
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const cls =
    tone === "ok"
      ? "border-success-border bg-gradient-to-br from-success-bg to-white"
      : tone === "warn"
        ? "border-warning-border bg-gradient-to-br from-warning-bg to-white"
        : "border-line bg-surface-1";
  return (
    <Card className={`rounded-2xl ${cls}`}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-content-3">
          {icon}
          {label}
        </div>
        <div className="mt-2 font-mono text-3xl font-black tracking-tight text-content-1">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
