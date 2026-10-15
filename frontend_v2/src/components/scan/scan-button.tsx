"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";

import { QrScanner } from "@/components/gate/qr-scanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { routeForScannedText } from "@/services/maintenance";

/**
 * Camera scan for every role: a machine or location QR opens its card, and the
 * card shows what the viewer's role may do there. Lives in the header so it is
 * one tap away on a phone.
 */
export function ScanButton({ compact = false, testId = "scan-trigger" }: { compact?: boolean; testId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={compact ? "h-11 w-11 rounded-xl border-line bg-surface-1/95 shadow-sm" : "h-10 rounded-xl"}
        aria-label="Scan a machine or location QR"
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        <ScanLine className={compact ? "h-5 w-5" : "mr-1.5 h-4 w-4"} />
        {compact ? null : "Scan"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-4">
          <DialogHeader>
            <DialogTitle>Scan QR · QR स्कैन करें</DialogTitle>
            <DialogDescription>Point the camera at the QR on the machine or the stock location.</DialogDescription>
          </DialogHeader>
          {open ? (
            <QrScanner
              onClose={() => setOpen(false)}
              onCode={(raw) => {
                const route = routeForScannedText(raw);
                if (!route) {
                  toast({ variant: "destructive", title: "Not an ERP QR", description: "This code is not a machine or location QR from this ERP." });
                  return;
                }
                setOpen(false);
                router.push(route);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
