import { redirect } from "next/navigation"

export default function StockCountPage() {
  redirect("/inventory/stock-lifecycle?tab=count")
}
