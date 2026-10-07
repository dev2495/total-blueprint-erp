import { GateQrPoster } from "@/components/gate/gate-qr-poster";
import { GuardOwner } from "@/components/gate/gate-guards";

export default function GateQrPage() {
  return (
    <GuardOwner>
      <GateQrPoster />
    </GuardOwner>
  );
}
