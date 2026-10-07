import { VisitorQueue } from "@/components/gate/visitor-queue";
import { GuardLog } from "@/components/gate/gate-guards";

export default function GateVisitorsPage() {
  return (
    <GuardLog>
      <VisitorQueue />
    </GuardLog>
  );
}
