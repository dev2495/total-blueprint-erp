import { PublicVisitorRegistration } from "@/components/gate/public-visitor";

/** Bare /visit without a gate token: show the "scan the gate QR" state. */
export default function VisitPage() {
  return <PublicVisitorRegistration token="" />;
}
