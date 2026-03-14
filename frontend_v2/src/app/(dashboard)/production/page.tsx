import { redirect } from "next/navigation"

export default function ProductionRootRedirect() {
  redirect("/production/planner")
}
