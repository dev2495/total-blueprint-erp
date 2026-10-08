import { BillCapture } from "@/components/gate/bill-capture";
import { GuardBillSubmit } from "@/components/gate/gate-guards";

/** Inward arrival = photo of the bill (no typing). */
export default function GateInwardBillsPage() {
  return (
    <GuardBillSubmit>
      <BillCapture />
    </GuardBillSubmit>
  );
}
