"use client";

/**
 * Field label wiring: a field wrapper gives its visible label an id and puts it in context; the
 * Input, Textarea and Select trigger inside name themselves from it (aria-labelledby) unless they
 * already carry an aria-label or aria-labelledby. Screen readers then read "Master name, edit"
 * instead of an unnamed field.
 */
import * as React from "react";

const FieldLabelContext = React.createContext<string | undefined>(undefined);

export function useFieldLabelId() {
  return React.useContext(FieldLabelContext);
}

export function FieldLabelProvider({ id, children }: { id: string; children: React.ReactNode }) {
  return <FieldLabelContext.Provider value={id}>{children}</FieldLabelContext.Provider>;
}

/** aria-labelledby for a control: its own naming wins, else the surrounding field's label. */
export function useLabelledBy(props: { "aria-label"?: string; "aria-labelledby"?: string }) {
  const fieldLabelId = useFieldLabelId();
  if (props["aria-label"] || props["aria-labelledby"]) return props["aria-labelledby"];
  return fieldLabelId;
}
