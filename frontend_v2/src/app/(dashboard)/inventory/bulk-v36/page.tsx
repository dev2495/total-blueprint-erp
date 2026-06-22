import { redirect } from "next/navigation";

export default function LegacyBulkWorkspaceRedirect() {
  redirect("/inventory/bulk");
}
