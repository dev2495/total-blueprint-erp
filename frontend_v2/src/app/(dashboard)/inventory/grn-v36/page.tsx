import { redirect } from "next/navigation";

export default function LegacyGrnWorkspaceRedirect() {
  redirect("/inventory/grn");
}
