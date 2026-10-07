"use client";

import { useCallback, useRef, useState } from "react";
import { describeApiError, extractApiErrorMap, getApiErrorStatus } from "@/lib/api";
import { PublicGateError } from "@/services/gate";

/**
 * One human action → one client_token → one frozen payload.
 *
 * - The payload is snapshotted at the first tap and every retry resends the
 *   identical bytes with the identical token, so a slow network or a double
 *   tap can never create two gate rows.
 * - "uncertain" means we do not know whether the server saved it (timeout,
 *   offline, 5xx, 429). The form stays locked; the only paths are "send the
 *   same entry again" or an explicit, warned release.
 * - "rejected" means the server definitively refused (4xx). Nothing was
 *   saved, the form unlocks with every field intact and the next tap is a new
 *   human action with a new token.
 * - "saved" only after the server returns a stored receipt.
 */

export type GateOperationPhase = "idle" | "sending" | "uncertain" | "rejected" | "saved";

export function newClientToken(): string {
  const cryptoRef = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    try {
      return cryptoRef.randomUUID();
    } catch {
      // randomUUID is unavailable on insecure LAN origins; fall through.
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
  } else {
    throw new Error("This browser cannot create a secure entry token.");
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deep-copy plain data; Blobs are immutable so they are kept by reference. */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map((item) => freeze(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) out[key] = freeze(item);
  }
  return Object.freeze(out) as T;
}

function statusOf(error: unknown): number | null {
  if (error instanceof PublicGateError) return error.status;
  return getApiErrorStatus(error);
}

/** Machine-readable server code (e.g. GATE_ID_STORAGE_UNAVAILABLE), if any. */
export function gateErrorCode(error: unknown): string {
  if (error instanceof PublicGateError) return error.code;
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const detail = record.detail && typeof record.detail === "object" ? (record.detail as Record<string, unknown>) : {};
  return String(record.code ?? detail.code ?? "").trim();
}

/** Optional-ID storage is off: definitively not saved, safe to resend without the ID. */
export const GATE_ID_STORAGE_UNAVAILABLE = "GATE_ID_STORAGE_UNAVAILABLE";

export function isUncertainFailure(error: unknown): boolean {
  const status = statusOf(error);
  if (status === null || status === 0) return true; // offline / timeout / aborted
  if (status === 408 || status === 429) return true;
  // Any 5xx (503 included) may arrive after the DB committed, so it stays
  // uncertain unless the server names a specific pre-commit refusal.
  if (status >= 500) return gateErrorCode(error) !== GATE_ID_STORAGE_UNAVAILABLE;
  return false;
}

export function gateErrorMessage(error: unknown, fallback = "Could not save. Nothing was recorded."): string {
  if (error instanceof PublicGateError) return error.message;
  const status = getApiErrorStatus(error);
  if (status === null) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") return "The gate server did not answer in time.";
    return "No network connection to the gate server.";
  }
  const clean = (text: string) =>
    text
      .split(" • ")
      .filter((part) => !/^request failed\.?$/i.test(part.trim()))
      .join(" • ") || fallback;
  if (status === 403) return clean(describeApiError(error, "You are not allowed to do this at this gate."));
  return clean(describeApiError(error, fallback));
}

export function gateFieldErrors(error: unknown): Record<string, string> {
  if (error instanceof PublicGateError) return error.fields;
  return extractApiErrorMap(error);
}

type Options<P, R> = {
  send: (payload: P & { client_token: string }) => Promise<R>;
  onSaved?: (result: R, payload: P) => void | Promise<unknown>;
};

export function useGateOperation<P extends object, R>({ send, onSaved }: Options<P, R>) {
  const [phase, setPhase] = useState<GateOperationPhase>("idle");
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<R | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [refreshPending, setRefreshPending] = useState(false);
  const frozenRef = useRef<(P & { client_token: string }) | null>(null);
  const inFlightRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const dispatch = useCallback(async () => {
    const frozen = frozenRef.current;
    if (!frozen || inFlightRef.current) return null;
    inFlightRef.current = true;
    setPhase("sending");
    setError(null);
    setAttempts((n) => n + 1);
    let saved: R;
    try {
      saved = await sendRef.current(frozen);
    } catch (caught) {
      setError(caught);
      if (isUncertainFailure(caught)) {
        setPhase("uncertain");
      } else {
        // Definitive refusal: nothing saved, form unlocks, token retired.
        frozenRef.current = null;
        setPhase("rejected");
      }
      inFlightRef.current = false;
      return null;
    }
    // Server receipt in hand: SAVED is final. Follow-up cache refreshes run
    // separately and can never demote it to an error.
    frozenRef.current = null;
    inFlightRef.current = false;
    setResult(saved);
    setPhase("saved");
    setRefreshPending(false);
    const { client_token: _token, ...rest } = frozen;
    void _token;
    try {
      const maybe = onSavedRef.current?.(saved, rest as unknown as P) as unknown;
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        (maybe as Promise<unknown>).catch(() => setRefreshPending(true));
      }
    } catch {
      setRefreshPending(true);
    }
    return saved;
  }, []);

  /** First tap of a human action. While uncertain, re-sends the frozen entry instead. */
  const submit = useCallback(
    (payload: P) => {
      if (inFlightRef.current) return Promise.resolve(null);
      if (!frozenRef.current) {
        frozenRef.current = freeze({ ...payload, client_token: newClientToken() });
      }
      return dispatch();
    },
    [dispatch],
  );

  /** Same token, same bytes. */
  const retry = useCallback(() => dispatch(), [dispatch]);

  /** Explicit unlock after an uncertain send (user verified it did not save). */
  const release = useCallback(() => {
    frozenRef.current = null;
    setPhase("idle");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    frozenRef.current = null;
    setPhase("idle");
    setError(null);
    setResult(null);
    setAttempts(0);
    setRefreshPending(false);
  }, []);

  return {
    phase,
    error,
    result,
    attempts,
    refreshPending,
    locked: phase === "sending" || phase === "uncertain",
    token: frozenRef.current?.client_token ?? null,
    submit,
    retry,
    release,
    reset,
  };
}
