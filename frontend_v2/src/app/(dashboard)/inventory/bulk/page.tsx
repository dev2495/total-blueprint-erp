import { redirect } from "next/navigation"

export default function BulkInventoryEntryPage() {
  redirect("/inventory?tab=bulk")
}
