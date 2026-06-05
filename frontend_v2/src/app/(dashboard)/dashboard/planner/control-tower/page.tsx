import { redirect } from "next/navigation";

export default function ControlTowerIndex() {
  redirect("/dashboard/planner/control-tower/command");
}
