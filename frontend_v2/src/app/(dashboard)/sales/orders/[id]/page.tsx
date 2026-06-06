"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { salesService } from "@/services/sales";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Package,
  Factory,
  FileText,
  Activity,
  Zap,
  AlertCircle,
  CheckCircle2,
  Layers,
  Maximize2,
  ChevronRight,
  Loader2,
  Lock,
} from "lucide-react";
import { StatusBadge } from "@/components/ui-custom/status-badge";
import { cn } from "@/lib/utils";
import { orderAge, ORDER_AGE_TONE_CLASSES } from "@/lib/order-age";
import Link from "next/link";

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Array.isArray(params?.id)
    ? params.id[0]
    : String(params?.id || "");

  const {
    data: order,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sales-order", id],
    queryFn: () => salesService.getOrder(id),
  });

  const confirmMutation = useMutation({
    mutationFn: () => salesService.confirmOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-order", id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-content-4">
            Loading Order Protocol...
          </p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center">
        <AlertCircle className="h-16 w-16 text-danger-fg mb-4" />
        <h1 className="text-2xl font-black text-content-1">
          Protocol Not Found
        </h1>
        <p className="text-content-3 mt-2">
          The requested Sales Order could not be located in the ledger.
        </p>
        <Button
          onClick={() => router.back()}
          className="mt-8 rounded-xl px-8 h-12 bg-surface-3"
        >
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="erp-soft-canvas min-h-screen space-y-10 p-8 lg:p-12">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto hover:bg-transparent text-content-4 hover:text-content-3 transition-colors"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Ledger
          </Button>
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-info-bg border border-info-border text-primary text-[10px] font-black uppercase tracking-widest shadow-sm">
              <Zap className="h-3 w-3 fill-info-fg" /> Protocol ID:{" "}
              {order.order_number}
            </div>
            <h1 className="text-4xl font-black tracking-tight text-content-1">
              {order.customer_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-content-3 font-bold text-sm">
              {(() => {
                const placedAt = order.created_at;
                if (!placedAt) return null;
                const age = orderAge(placedAt);
                return (
                  <>
                    <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-info-bg ring-1 ring-info-border">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="text-content-2">Order placed</span>
                      <span className="text-content-1">{age.placedOn}</span>
                    </span>
                    {age.days !== null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider ring-1 ring-inset shadow-sm",
                          ORDER_AGE_TONE_CLASSES[age.tone],
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                        {age.days === 0
                          ? "Today"
                          : age.days === 1
                            ? "Yesterday"
                            : `${age.days}d ago`}
                      </span>
                    )}
                    {order.delivery_date && (
                      <span className="flex items-center gap-2 text-content-4 text-xs">
                        <Clock className="h-3.5 w-3.5" />
                        Due{" "}
                        {new Date(order.delivery_date).toLocaleDateString(
                          undefined,
                          { day: "2-digit", month: "short" },
                        )}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <StatusBadge
            status={order.status}
            className="scale-125 origin-right"
          />
          {order.status === "DRAFT" && (
            <Button
              className="bg-primary hover:bg-primary text-white font-black uppercase text-xs tracking-wider px-8 h-12 rounded-xl shadow-xl "
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              Confirm Commercial
            </Button>
          )}
          {order.status === "PLANNING_REQUIRED" && (
            <p className="text-[11px] font-bold text-warning-fg uppercase tracking-wide">
              Waiting for Planner Control Hub action
            </p>
          )}
          {(order.status === "RELEASED" ||
            order.status === "PACKING_READY" ||
            order.status === "DISPATCH_READY" ||
            order.status === "PLANNED") && (
            <Button
              asChild
              className="rounded-xl bg-success-fg hover:bg-success-fg text-white font-black uppercase text-xs tracking-wider h-11 px-7 shadow-md "
            >
              <Link href={`/sales/orders/${id}/dispatches`}>
                <Package className="h-4 w-4 mr-2" /> Dispatches
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            className="rounded-xl font-bold uppercase text-[10px] tracking-wider h-9 px-4"
          >
            <Link href={`/sales/orders/${id}/dispatches`}>
              <ChevronRight className="h-3 w-3 mr-1" /> Dispatch ledger
            </Link>
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-8">
        <TabsList className="bg-surface-1 p-1.5 rounded-2xl border-2 border-line h-auto flex gap-1 shadow-sm w-fit">
          <TabsTrigger
            value="overview"
            className="rounded-xl px-6 py-2.5 text-[11px] font-black uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="items"
            className="rounded-xl px-6 py-2.5 text-[11px] font-black uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
          >
            Line Items ({order.items?.length || 0})
          </TabsTrigger>
          <TabsTrigger
            value="specs"
            className="rounded-xl px-6 py-2.5 text-[11px] font-black uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
          >
            Technical Specs
          </TabsTrigger>
          <TabsTrigger
            value="tracking"
            className="rounded-xl px-6 py-2.5 text-[11px] font-black uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
          >
            Flow Tracking
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-xl px-6 py-2.5 text-[11px] font-black uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
          >
            Documents
          </TabsTrigger>
        </TabsList>

        {/* Overview Content */}
        <TabsContent
          value="overview"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-8 space-y-4">
              <div className="p-3 bg-info-bg rounded-2xl w-fit">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-content-4 font-black text-[10px] uppercase tracking-widest">
                  Total Weight
                </h3>
                <p className="text-3xl font-black text-content-1 mt-1">
                  {order.items
                    ?.reduce(
                      (acc: number, item: any) =>
                        acc + (item.total_weight_kg || 0),
                      0,
                    )
                    .toLocaleString()}{" "}
                  <span className="text-lg text-content-4">KG</span>
                </p>
              </div>
            </Card>
            <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-8 space-y-4">
              <div className="p-3 bg-success-bg rounded-2xl w-fit">
                <CheckCircle2 className="h-6 w-6 text-success-fg" />
              </div>
              <div>
                <h3 className="text-content-4 font-black text-[10px] uppercase tracking-widest">
                  Job Status
                </h3>
                <p className="text-3xl font-black text-content-1 mt-1">
                  {order.status === "COMPLETED" ? "100%" : "32%"}{" "}
                  <span className="text-lg text-content-4">PROCEDURAL</span>
                </p>
              </div>
            </Card>
            <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-8 space-y-4">
              <div className="p-3 bg-warning-bg rounded-2xl w-fit">
                <Activity className="h-6 w-6 text-warning-fg" />
              </div>
              <div>
                <h3 className="text-content-4 font-black text-[10px] uppercase tracking-widest">
                  Order Type
                </h3>
                <p className="text-3xl font-black text-content-1 mt-1 uppercase">
                  {order.order_type}
                </p>
              </div>
            </Card>
          </div>

          <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 overflow-hidden">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-2 italic">
                <FileText className="h-5 w-5 text-primary" /> Protocol Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 pt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-content-4 uppercase tracking-widest">
                    Customer ID
                  </span>
                  <p className="font-bold text-content-2">
                    {order.customer_id || "CUST-3829"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-content-4 uppercase tracking-widest">
                    Entity Site
                  </span>
                  <p className="font-bold text-content-2">
                    {order.plant_name || "PRIMARY HUB"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-content-4 uppercase tracking-widest">
                    Lead Strategist
                  </span>
                  <p className="font-bold text-content-2">ADMINISTRATOR</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-content-4 uppercase tracking-widest">
                    Validation Status
                  </span>
                  <p className="font-bold text-success-fg italic uppercase">
                    AUTHENTICATED
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Items Content */}
        <TabsContent
          value="items"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="grid grid-cols-1 gap-4">
            {order.items?.map((item: any, idx: number) => (
              <Card
                key={idx}
                className="border-none shadow-premium rounded-[2rem] bg-surface-1 group hover:bg-surface-2 transition-all duration-300"
              >
                <CardContent className="p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-6">
                    <div className="h-16 w-16 rounded-2xl bg-info-bg flex items-center justify-center text-primary shadow-inner group-hover:bg-surface-1 transition-colors">
                      <Package className="h-8 w-8" />
                    </div>
                    <div>
                      <h4 className="text-xl font-black text-content-1 group-hover:text-primary transition-colors uppercase italic">
                        {item.template_name || "SKU PROTOCOL"}
                      </h4>
                      <div className="flex items-center gap-3 mt-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-black border-line uppercase tracking-tighter"
                        >
                          {item.qty_value} {item.qty_uom}
                        </Badge>
                        <span className="text-content-4">•</span>
                        <span className="text-xs font-bold text-content-4 italic">
                          Total Load: {item.total_weight_kg || 0} KG
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <div className="text-right space-y-1">
                      <span className="text-[10px] font-black text-content-4 uppercase tracking-widest">
                        Production State
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 bg-surface-2 rounded-full overflow-hidden">
                          <div className="h-full bg-success-fg w-[65%]" />
                        </div>
                        <span className="text-sm font-black text-success-fg italic">
                          65%
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`#`}
                      className="h-12 w-12 rounded-xl border-2 border-line flex items-center justify-center text-content-4 hover:bg-surface-3 hover:text-white transition-all"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Technical Specs Content */}
        <TabsContent
          value="specs"
          className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {order.items?.map((item: any, idx: number) => (
            <div key={idx} className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="h-0.5 flex-1 bg-surface-2" />
                <h3 className="text-xs font-black uppercase text-content-4 tracking-widest italic">
                  {item.template_name} — Spec Sheet
                </h3>
                <div className="h-0.5 flex-1 bg-surface-2" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Maximize2 className="h-5 w-5 text-primary" />
                    <h4 className="text-lg font-black uppercase italic">
                      Dimensional Geometry
                    </h4>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-surface-2 p-4 rounded-2xl">
                      <span className="text-[10px] font-black text-content-4 uppercase block mb-1">
                        Base Width
                      </span>
                      <span className="text-xl font-black text-content-1">
                        {item.geometry_snapshot?.base?.width_mm || 400} MM
                      </span>
                    </div>
                    <div className="bg-surface-2 p-4 rounded-2xl">
                      <span className="text-[10px] font-black text-content-4 uppercase block mb-1">
                        Base Height
                      </span>
                      <span className="text-xl font-black text-content-1">
                        {item.geometry_snapshot?.base?.height_mm || 600} MM
                      </span>
                    </div>
                  </div>
                </Card>
                <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Layers className="h-5 w-5 text-primary" />
                    <h4 className="text-lg font-black uppercase italic">
                      Material Architecture
                    </h4>
                  </div>
                  <div className="space-y-3">
                    {item.bom_snapshot?.components?.map(
                      (component: any, cIdx: number) => (
                        <div
                          key={cIdx}
                          className="flex items-center justify-between p-3 bg-surface-2 rounded-xl border border-line"
                        >
                          <div className="flex items-center gap-3">
                            <span className="h-6 w-6 rounded-full bg-surface-1 flex items-center justify-center text-[10px] font-black text-primary border border-info-border">
                              {cIdx + 1}
                            </span>
                            <span className="text-sm font-bold text-content-2">
                              {component.material_name}
                            </span>
                          </div>
                          <span className="text-xs font-black text-primary italic">
                            {component.thickness_micron || 30}µ
                          </span>
                        </div>
                      ),
                    ) || (
                      <div className="text-center py-6 text-content-4 italic text-sm">
                        No BOM architecture defined.
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Tracking Content */}
        <TabsContent
          value="tracking"
          className="animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <Card className="border-none shadow-premium rounded-[3rem] bg-surface-3 p-12 overflow-hidden relative group">
            <div className="relative z-10 flex flex-col items-center text-center space-y-6">
              <div className="h-20 w-20 rounded-3xl bg-primary flex items-center justify-center text-info-fg group-hover:scale-110 transition-transform duration-500">
                <Activity className="h-10 w-10 animate-pulse" />
              </div>
              <div className="space-y-4">
                <h3 className="text-4xl font-black text-white italic tracking-tight">
                  Order Intelligence Hub
                </h3>
                <p className="text-content-4 font-medium max-w-lg mx-auto leading-relaxed">
                  Deep-dive into granular production lineage, live machine
                  metrics, and logistical milestones for Protocol{" "}
                  <span className="text-info-fg font-black">
                    {order.order_number}
                  </span>
                  .
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  className="bg-primary text-white hover:bg-primary font-black uppercase text-xs tracking-[0.2em] px-10 h-16 rounded-2xl shadow-2xl transition-all active-scale"
                  onClick={() => router.push(`/sales/orders/${id}/tracking`)}
                >
                  Launch Intelligence Engine{" "}
                  <ArrowRight className="h-5 w-5 ml-3" />
                </Button>
              </div>
            </div>
            {/* Decorative Background */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-primary rounded-full blur-[120px]" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-primary rounded-full blur-[120px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(15,23,42,0.8)_100%)] pointer-events-none" />
          </Card>
        </TabsContent>

        {/* Documents Content */}
        <TabsContent
          value="documents"
          className="animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {["Sales Protocol", "Technical Drawing", "Quality Certificate"].map(
              (doc, idx) => (
                <Card
                  key={idx}
                  className="border-none shadow-premium rounded-[2rem] bg-surface-1 p-6 flex items-center justify-between group hover:border-2 hover:border-info-border transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-surface-2 flex items-center justify-center text-content-4 group-hover:bg-info-bg group-hover:text-primary transition-colors">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-content-1 uppercase italic leading-none">
                        {doc}
                      </h4>
                      <span className="text-[10px] font-bold text-content-4 uppercase tracking-widest mt-1 block">
                        PDF Protocol
                      </span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-xl">
                    <Download className="h-4 w-4 text-content-4" />
                  </Button>
                </Card>
              ),
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Sticky Decoration */}
      <div className="fixed bottom-10 right-10 flex flex-col gap-3">
        <div className="bg-surface-3 text-white px-6 py-4 rounded-[2rem] shadow-2xl flex items-center gap-4 animate-in slide-in-from-right-10 duration-1000">
          <div className="h-2 w-2 rounded-full bg-success-fg animate-ping" />
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50 italic leading-none mb-1">
              Ledger Integrity
            </span>
            <span className="text-xs font-black uppercase tracking-widest">
              Protocol Verified
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function Download(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
