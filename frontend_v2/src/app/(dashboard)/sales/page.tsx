import { redirect } from "next/navigation"

export default function SalesRootRedirect() {
  redirect("/sales/orders")
}
