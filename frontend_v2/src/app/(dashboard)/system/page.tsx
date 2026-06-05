import { redirect } from "next/navigation";

export default function SystemRootRedirect() {
  redirect("/system/users");
}
