import { ArrivalCapture } from "@/components/gate/arrival-capture";
import { GuardLog } from "@/components/gate/gate-guards";

/** Our own papers coming back in: scan the QR on the inter-plant challan, job-work challan or gate pass. */
export default function GateArrivalsPage() {
  return (
    <GuardLog>
      <ArrivalCapture />
    </GuardLog>
  );
}
