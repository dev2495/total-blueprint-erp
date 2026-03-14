import { redirect } from "next/navigation"

export default function InventoryRootRedirect() {
  redirect("/inventory/roll-explorer")
}
