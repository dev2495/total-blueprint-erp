import { OutwardCapture } from "@/components/gate/outward-capture";
import { GuardOutwardSubmit } from "@/components/gate/gate-guards";

/** Outward departure = scan the ERP QR (optional) + photos of every paper + vehicle. */
export default function GateOutwardPage() {
  return (
    <GuardOutwardSubmit>
      <OutwardCapture />
    </GuardOutwardSubmit>
  );
}
