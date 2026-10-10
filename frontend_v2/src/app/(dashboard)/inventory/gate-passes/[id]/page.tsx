"use client";

import { useParams } from "next/navigation";
import { GatePassDetail } from "@/components/gate-passes/gate-pass-detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function GatePassDetailPage() {
  const params = useParams();
  const raw = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  return <GatePassDetail id={UUID.test(raw) ? raw : ""} />;
}
