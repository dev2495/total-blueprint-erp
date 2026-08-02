import { redirect } from "next/navigation";

export default function LegacyGrnHistoryWorkspaceRedirect() {
  redirect("/inventory/grn-history");
}
