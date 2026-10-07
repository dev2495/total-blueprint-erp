import { GateHistory } from "@/components/gate/gate-history";
import { GuardOwner } from "@/components/gate/gate-guards";

export default function GateHistoryPage() {
  return (
    <GuardOwner>
      <GateHistory />
    </GuardOwner>
  );
}
