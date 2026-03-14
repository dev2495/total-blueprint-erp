import { redirect } from "next/navigation"

export default function OperatorDashboardRedirect() {
  // Legacy route kept for backward compatibility.
  redirect("/production/machine-selector")
}
