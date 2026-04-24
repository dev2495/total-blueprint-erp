import { redirect } from "next/navigation"

export default function OpeningStockPage() {
  redirect("/inventory/stock-lifecycle?tab=opening")
}
