import { redirect } from "next/navigation"

export default function InventoryCountPage() {
    redirect("/inventory/stock-lifecycle?tab=count")
}
