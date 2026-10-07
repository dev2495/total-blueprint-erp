import { WalkInVisitor } from "@/components/gate/walk-in-visitor";
import { GuardLog } from "@/components/gate/gate-guards";

export default function GateWalkInPage() {
  return (
    <GuardLog>
      <WalkInVisitor />
    </GuardLog>
  );
}
