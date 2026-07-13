import { redirect } from "next/navigation";

export default function LegacyTraceabilityWorkspaceRedirect() {
  redirect("/inventory/traceability");
}
