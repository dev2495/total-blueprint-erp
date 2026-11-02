"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { PouchStyleEditor } from "@/components/pouch-style/pouch-style-editor";

function NewStyle() {
  const forRoll = String(useSearchParams()?.get("for") || "").toLowerCase() === "roll";
  return <PouchStyleEditor initialMode="new" initialStyleFor={forRoll ? "ROLL" : "POUCH"} />;
}

export default function NewPouchStylePage() {
  return (
    <React.Suspense fallback={null}>
      <NewStyle />
    </React.Suspense>
  );
}
