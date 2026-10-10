"use client";

import { useParams } from "next/navigation";

import { GeneralReceiptDetail } from "@/components/documents-register/general-receipt-detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function GeneralReceiptDetailRoute() {
  const params = useParams();
  const raw = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  return <GeneralReceiptDetail id={UUID.test(raw) ? raw : ""} />;
}
