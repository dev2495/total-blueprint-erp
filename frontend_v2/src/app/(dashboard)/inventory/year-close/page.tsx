import { redirect } from "next/navigation"

export default function YearClosePage() {
  redirect("/inventory/stock-lifecycle?tab=yearclose")
}
