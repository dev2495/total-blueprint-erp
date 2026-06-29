"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Loader2, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  customerDispatchApi,
  type DispatchLine,
} from "@/services/customer-dispatch";

interface SalesOrderItemLite {
  id: string;
  template?: { name?: string } | null;
  template_name?: string | null;
  product_master_code?: string | null;
  product_master_name?: string | null;
  line_label?: string | null;
  product_spec?: Record<string, any> | null;
  line_name?: string;
  line_status?: string;
  line_status_display?: string;
  qty_value: number | string;
  qty_uom?: string;
  qty_dispatched?: number | string;
  qty_open?: number | string;
  qty_final_output?: number | string;
  qty_dispatchable?: number | string;
  qty_replan_remaining?: number | string;
}

interface SalesOrderDetail {
  id: string;
  order_number: string;
  customer_name: string;
  customer?: string | null;
  status: string;
  delivery_date?: string | null;
  items: SalesOrderItemLite[];
}

function isDispatchableLine(item: SalesOrderItemLite, orderStatus?: string) {
  const lineStatus = String(item.line_status || "").toUpperCase();
  if (lineStatus === "PARTIAL") return dispatchableQty(item, orderStatus) > 0;
  return statusAllowsDispatch(item, orderStatus);
}

function statusAllowsDispatch(item: SalesOrderItemLite, orderStatus?: string) {
  const lineStatus = String(item.line_status || "").toUpperCase();
  const parentStatus = String(orderStatus || "").toUpperCase();
  return (
    ["PACKING_READY", "DISPATCH_READY", "COMPLETED"].includes(lineStatus) ||
    ["PACKING_READY", "DISPATCH_READY"].includes(parentStatus)
  );
}

function dispatchableQty(item: SalesOrderItemLite, orderStatus?: string) {
  const lineStatus = String(item.line_status || "").toUpperCase();
  if (lineStatus === "PARTIAL") return Math.max(0, Number(item.qty_dispatchable ?? 0));
  if (!statusAllowsDispatch(item, orderStatus)) return 0;
  if (item.qty_dispatchable !== undefined && item.qty_dispatchable !== null) {
    return Math.max(0, Number(item.qty_dispatchable));
  }
  return Math.max(0, Number(item.qty_open ?? item.qty_value ?? 0));
}

function formatQty(value: number | string | null | undefined) {
  const qty = Number(value ?? 0);
  if (!Number.isFinite(qty)) return "0";
  return qty.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function lineLabel(item: SalesOrderItemLite, index: number) {
  return (
    item.line_label ||
    item.product_spec?.display_label ||
    item.product_spec?.line_label ||
    item.line_name ||
    item.product_master_code ||
    item.product_master_name ||
    item.template_name ||
    item.template?.name ||
    `Line ${index + 1}`
  );
}

export default function NewCustomerDispatchPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id || "";
  const router = useRouter();
  const { toast } = useToast();

  const orderQuery = useQuery({
    queryKey: ["sales-order-detail-for-dispatch", orderId],
    queryFn: async () => {
      const { data } = await api.get(`/api/sales/orders/${orderId}/`);
      return data as SalesOrderDetail;
    },
    enabled: !!orderId,
  });

  const order = orderQuery.data;

  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [lrNo, setLrNo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [dispatchDate, setDispatchDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [lineQtys, setLineQtys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!order) return;
    const next: Record<string, string> = {};
    for (const item of order.items || []) {
      const dispatchable = dispatchableQty(item, order.status);
      next[item.id] = dispatchable > 0 && isDispatchableLine(item, order.status) ? String(dispatchable) : "0";
    }
    setLineQtys(next);
  }, [order]);

  const dispatchableLines = useMemo<DispatchLine[]>(() => {
    if (!order) return [];
    return (order.items || [])
      .filter((item) => isDispatchableLine(item, order.status))
      .map((item) => ({
        sales_order_item: item.id,
        qty_dispatched: Number(lineQtys[item.id] || 0),
        uom: item.qty_uom || "KG",
      }))
      .filter((ln) => Number(ln.qty_dispatched) > 0);
  }, [order, lineQtys]);

  const totalQty = dispatchableLines.reduce(
    (acc, ln) => acc + Number(ln.qty_dispatched || 0),
    0,
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Order not loaded.");
      if (dispatchableLines.length === 0)
        throw new Error("Enter qty against at least one line.");
      const dispatch = await customerDispatchApi.create({
        sales_order: order.id,
        customer: order.customer || undefined,
        dispatch_date: dispatchDate,
        vehicle_no: vehicleNo,
        driver_name: driverName,
        lr_no: lrNo,
        invoice_no: invoiceNo,
        notes,
        lines: dispatchableLines,
      });
      return dispatch;
    },
    onSuccess: (dispatch) => {
      toast({
        title: "Dispatch created",
        description: `${dispatch.code} saved as DRAFT.`,
      });
      router.push(`/sales/orders/${orderId}/dispatches`);
    },
    onError: (err) =>
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const createAndConfirm = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Order not loaded.");
      if (dispatchableLines.length === 0)
        throw new Error("Enter qty against at least one line.");
      const dispatch = await customerDispatchApi.create({
        sales_order: order.id,
        customer: order.customer || undefined,
        dispatch_date: dispatchDate,
        vehicle_no: vehicleNo,
        driver_name: driverName,
        lr_no: lrNo,
        invoice_no: invoiceNo,
        notes,
        lines: dispatchableLines,
      });
      return customerDispatchApi.confirm(dispatch.id);
    },
    onSuccess: (dispatch) => {
      toast({
        title: "Dispatch confirmed",
        description: `${dispatch.code} is now CONFIRMED.`,
      });
      router.push(`/sales/orders/${orderId}/dispatches`);
    },
    onError: (err) =>
      toast({
        title: "Confirm failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  if (orderQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-content-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading order…
      </div>
    );
  }
  if (!order) {
    return <div className="p-8 text-sm text-danger-fg">Order not found.</div>;
  }

  return (
    <div className="min-h-screen space-y-6 bg-surface-2 p-6">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-success-fg via-success-fg to-success-fg px-8 py-7 text-white shadow-lg">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href={`/sales/orders/${orderId}/dispatches`}
              className="inline-flex items-center gap-1 rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/90 hover:bg-surface-1/20"
            >
              <ArrowLeft className="h-3 w-3" /> Back to dispatches
            </Link>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              New dispatch
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-success-border">
              Order{" "}
              <span className="font-mono font-bold">{order.order_number}</span>{" "}
              · {order.customer_name}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-success-border">
              Total qty
            </div>
            <div className="font-mono text-3xl font-black">
              {totalQty.toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      <Card className="border-line">
        <CardHeader>
          <CardTitle className="text-lg font-black text-content-1">
            Header
          </CardTitle>
          <CardDescription>
            Vehicle, driver, LR, invoice — all optional but recommended for
            traceability.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Dispatch date">
            <Input
              type="date"
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
            />
          </Field>
          <Field label="Vehicle no">
            <Input
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ01-XX-1234"
            />
          </Field>
          <Field label="Driver">
            <Input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Driver name"
            />
          </Field>
          <Field label="LR no">
            <Input
              value={lrNo}
              onChange={(e) => setLrNo(e.target.value)}
              placeholder="LR/EWB"
            />
          </Field>
          <Field label="Customer invoice">
            <Input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="INV-XXXX"
            />
          </Field>
          <Field label="Notes" wide>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to flag"
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="border-line">
        <CardHeader>
          <CardTitle className="text-lg font-black text-content-1">
            Lines
          </CardTitle>
          <CardDescription>
            Each row pre-fills only the quantity that is dispatchable now. For
            partial final output, the unproduced balance stays in Planner.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[10px] font-bold uppercase tracking-wide text-content-3">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Ordered</th>
                <th className="px-4 py-3 text-right">Already shipped</th>
                <th className="px-4 py-3 text-right">Open</th>
                <th className="px-4 py-3 text-right">Dispatchable</th>
                <th className="px-4 py-3 text-right">Dispatch now</th>
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map((item, index) => {
                const open = Number(item.qty_open ?? item.qty_value ?? 0);
                const ordered = Number(item.qty_value ?? 0);
                const shipped = Number(item.qty_dispatched ?? 0);
                const dispatchable = dispatchableQty(item, order.status);
                const replanRemaining = Number(item.qty_replan_remaining ?? 0);
                const isPartial = String(item.line_status || "").toUpperCase() === "PARTIAL";
                const ready = isDispatchableLine(item, order.status);
                return (
                  <tr key={item.id} className="border-b border-line">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-content-1">
                        {lineLabel(item, index)}
                      </div>
                      <div className="text-[11px] text-content-3">
                        {item.line_status_display || item.line_status || "Line status"} · UoM {item.qty_uom || "KG"}
                      </div>
                      {isPartial ? (
                        <div className="mt-2 inline-flex rounded-full border border-warning-border bg-warning-bg px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-warning-fg">
                          Final output: dispatch {formatQty(dispatchable)} now · planner replan {formatQty(replanRemaining)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatQty(ordered)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-content-3">
                      {formatQty(shipped)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-success-fg">
                      {formatQty(open)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-content-1">
                      {formatQty(dispatchable)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        className="ml-auto h-9 w-28 rounded-md text-right font-mono"
                        inputMode="decimal"
                        max={dispatchable}
                        value={lineQtys[item.id] ?? ""}
                        disabled={!ready || dispatchable <= 0}
                        onChange={(e) =>
                          setLineQtys((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || createAndConfirm.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Truck className="mr-2 h-4 w-4" />
          )}
          Save draft
        </Button>
        <Button
          className="rounded-full bg-success-fg text-white hover:bg-success-fg"
          onClick={() => createAndConfirm.mutate()}
          disabled={createMutation.isPending || createAndConfirm.isPending}
        >
          {createAndConfirm.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ClipboardCheck className="mr-2 h-4 w-4" />
          )}
          Save &amp; confirm
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2 lg:col-span-3" : ""}>
      <Label className="text-[10px] font-bold uppercase tracking-wide text-content-3">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
