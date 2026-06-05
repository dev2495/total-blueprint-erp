import { redirect } from "next/navigation";

export default function InventoryPeriodPage() {
  redirect("/inventory/stock-lifecycle?tab=close");
}
