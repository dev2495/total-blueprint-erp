import { redirect } from "next/navigation"

export default function RollExplorerEntryPage() {
  redirect("/inventory?tab=rolls")
}
