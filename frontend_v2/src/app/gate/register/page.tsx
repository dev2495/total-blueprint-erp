import { TodayRegister } from "@/components/gate/today-register";
import { GuardLog } from "@/components/gate/gate-guards";

export default function GateRegisterPage() {
  return (
    <GuardLog>
      <TodayRegister />
    </GuardLog>
  );
}
