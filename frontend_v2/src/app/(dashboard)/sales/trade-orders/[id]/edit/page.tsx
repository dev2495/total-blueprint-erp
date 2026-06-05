"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { TradeOrderForm } from "@/components/trade-orders/trade-order-form";
import { tradeOrderService } from "@/services/trade-orders";

export default function EditTradeOrderPage() {
  const params = useParams();
  const id =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
        ? params.id[0]
        : "";
  const { data: order, isLoading } = useQuery({
    queryKey: ["trade-order", id],
    queryFn: () => tradeOrderService.get(id),
    enabled: !!id,
  });

  if (isLoading || !order) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-content-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  return <TradeOrderForm mode="edit" initialOrder={order} />;
}
