import { redirect } from "next/navigation";

export default function LegacyRollsWorkspaceRedirect() {
  redirect("/inventory/rolls");
}
