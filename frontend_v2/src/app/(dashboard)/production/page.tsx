import { redirect } from "next/navigation"

export default function ProductionRootRedirect() {
  redirect("/dashboard/planner/control-tower/command")
}
