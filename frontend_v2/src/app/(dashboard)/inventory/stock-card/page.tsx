import { redirect } from "next/navigation"

export default function StockCardPage() {
  redirect("/inventory/stock-lifecycle?tab=stockcard")
}
