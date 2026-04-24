import { redirect } from "next/navigation"

export default function InventoryFyCorrectionPage() {
  redirect("/inventory/stock-lifecycle?tab=correction")
}
