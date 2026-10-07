import { WalkInVisitor } from "@/components/gate/walk-in-visitor";
import { GuardOwner } from "@/components/gate/gate-guards";

/** Owner-only: visitors record their own entry by QR; watchmen only confirm exit. */
export default function GateWalkInPage() {
  return (
    <GuardOwner>
      <WalkInVisitor />
    </GuardOwner>
  );
}
