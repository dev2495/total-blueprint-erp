import { redirect } from "next/navigation"

export default function OrdersLegacyRedirectPage() {
    redirect("/sales/orders")
}
