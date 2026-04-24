import { redirect } from "next/navigation"

export default function PackagingInventoryEntryPage() {
  redirect("/inventory?tab=packaging")
}
