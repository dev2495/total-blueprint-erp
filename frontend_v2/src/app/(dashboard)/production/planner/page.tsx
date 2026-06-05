import { redirect } from "next/navigation";

export default function LegacyPlannerRedirect() {
  redirect("/dashboard/planner/control-tower/command");
}
