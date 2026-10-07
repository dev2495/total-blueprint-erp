import { GateSetup } from "@/components/gate/gate-setup";
import { GuardOwner } from "@/components/gate/gate-guards";

export default function GateSetupPage() {
  return (
    <GuardOwner>
      <GateSetup />
    </GuardOwner>
  );
}
