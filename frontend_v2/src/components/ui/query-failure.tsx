"use client";
import { Button } from "./button";
export function QueryFailure({ subject, retry }: { subject: string; retry: () => void }) {
  return <div role="alert" className="m-4 rounded-xl border border-danger-border bg-danger-bg p-5 text-danger-fg">
    <h2 className="font-semibold">{subject} could not be loaded</h2>
    <p className="my-2 text-sm">The current data is unavailable. Retry before making a stock or planning decision.</p>
    <Button variant="outline" onClick={retry}>Retry</Button>
  </div>;
}
