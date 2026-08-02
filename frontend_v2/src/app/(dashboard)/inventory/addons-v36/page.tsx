import { redirect } from "next/navigation";

export default function LegacyAddonsWorkspaceRedirect() {
  redirect("/inventory/addons");
}
