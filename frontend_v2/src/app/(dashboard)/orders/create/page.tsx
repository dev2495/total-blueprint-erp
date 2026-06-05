import { redirect } from "next/navigation";

export default function OrdersCreateLegacyRedirectPage() {
  redirect("/sales/orders/create");
}
