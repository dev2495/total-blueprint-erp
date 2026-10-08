"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { DIRECTION_META } from "./gate-format";
import { DirectionGlyph } from "./gate-ui";
import { useGate } from "./gate-shell";
import { TodayArrivals } from "./bill-capture";

/** Goods tab: two separate lanes — inward by bill photo, outward by typed register. */
export function GoodsHub() {
  const { canSubmitBills, canLog } = useGate();
  return (
    <div className="mx-auto max-w-[640px] space-y-5">
      <div className="px-1 pt-1">
        <div className="text-[13px] font-medium text-content-3">Goods at the gate</div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">What is happening?</h1>
      </div>
      <div className="grid gap-3">
        {canSubmitBills ? (
          <Link
            href="/gate/inward-bills"
            className="gate-press flex min-h-[96px] items-center gap-4 rounded-[22px] p-4 text-white"
            style={{ background: DIRECTION_META.INWARD.tone }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <Camera className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <span className="block text-[19px] font-semibold leading-tight">Goods coming in</span>
              <span className="block text-[14px] text-white/85">Take a photo of the bill — nothing to type</span>
            </span>
          </Link>
        ) : null}
        {canLog ? (
          <Link
            href="/gate/goods?direction=OUTWARD"
            className="gate-press flex min-h-[96px] items-center gap-4 rounded-[22px] p-4 text-white"
            style={{ background: DIRECTION_META.OUTWARD.tone }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <DirectionGlyph direction="OUTWARD" className="h-6 w-6 !text-white" />
            </span>
            <span className="min-w-0">
              <span className="block text-[19px] font-semibold leading-tight">Goods going out</span>
              <span className="block text-[14px] text-white/85">Log the invoice / challan and vehicle</span>
            </span>
          </Link>
        ) : null}
      </div>
      {canSubmitBills ? <TodayArrivals /> : null}
    </div>
  );
}
