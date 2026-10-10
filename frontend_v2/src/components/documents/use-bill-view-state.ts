"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Per-document reading state for the bill workspace.
 *
 * - View state (page, zoom, pan, rotation, mode, region pin, sheet snap) lives in
 *   sessionStorage under `bill-view:<id>`: per tab, survives re-renders, dropdowns,
 *   section switches and a refresh. It never contains image bytes or URLs.
 * - Layout preferences that are not tied to one document (split ratio, float
 *   window geometry) live in localStorage.
 * - A pop-out window and the docked workspace keep page / zoom / rotation / pin in
 *   step through `BroadcastChannel("bill-view-" + id)`.
 */

export type BillWorkspaceMode = "dock" | "float" | "hidden" | "popout";
/** "fit-width" | "fit-page" | factor relative to fit width (1 = 100 %). */
export type BillZoom = "fit-width" | "fit-page" | number;
export type BillSheetSnap = "peek" | "half" | "full";
export type ViewRotation = 0 | 90 | 180 | 270;

/** Rectangle in normalised coordinates of the unrotated page image (0..1). */
export interface BillRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BillViewState {
  page: number;
  zoom: BillZoom;
  /** Normalised point of the (rotated) page shown at the centre of the viewer; null = default alignment. */
  center: { x: number; y: number } | null;
  /** View-only rotation per page id; falls back to the page's saved display_rotation. */
  rotations: Record<string, ViewRotation>;
  /** null = the device default. */
  mode: BillWorkspaceMode | null;
  /** Mode to return to from pop-out / hidden. */
  lastVisibleMode: "dock" | "float" | null;
  pin: BillRegion | null;
  /** True while the view follows the pin (re-applied on page switch / resize). */
  pinFollow: boolean;
  sheet: BillSheetSnap;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

export const DEFAULT_VIEW: BillViewState = {
  page: 0,
  zoom: "fit-width",
  center: null,
  rotations: {},
  mode: null,
  lastVisibleMode: null,
  pin: null,
  pinFollow: false,
  sheet: "peek",
};

export type BillViewPatch = Partial<BillViewState> | ((current: BillViewState) => Partial<BillViewState>);

const STORAGE_PREFIX = "bill-view:";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sanitizeRegion(raw: unknown): BillRegion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (![r.x, r.y, r.w, r.h].every(isFiniteNumber)) return null;
  const region = { x: clamp01(r.x as number), y: clamp01(r.y as number), w: clamp01(r.w as number), h: clamp01(r.h as number) };
  return region.w > 0.005 && region.h > 0.005 ? region : null;
}

export function sanitizeZoom(raw: unknown): BillZoom {
  if (raw === "fit-width" || raw === "fit-page") return raw;
  if (isFiniteNumber(raw)) return Math.max(MIN_ZOOM / 4, Math.min(MAX_ZOOM, raw));
  return "fit-width";
}

function sanitizeRotation(raw: unknown): ViewRotation | null {
  return raw === 0 || raw === 90 || raw === 180 || raw === 270 ? raw : null;
}

/** Parse untrusted stored / broadcast data into a safe view state. */
export function sanitizeView(raw: unknown): BillViewState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VIEW };
  const r = raw as Record<string, unknown>;
  const rotations: Record<string, ViewRotation> = {};
  if (r.rotations && typeof r.rotations === "object") {
    for (const [key, value] of Object.entries(r.rotations as Record<string, unknown>)) {
      const rotation = sanitizeRotation(value);
      if (rotation !== null && key.length <= 64) rotations[key] = rotation;
    }
  }
  const center =
    r.center && typeof r.center === "object" && isFiniteNumber((r.center as { x?: unknown }).x) && isFiniteNumber((r.center as { y?: unknown }).y)
      ? { x: clamp01((r.center as { x: number }).x), y: clamp01((r.center as { y: number }).y) }
      : null;
  const mode = r.mode === "dock" || r.mode === "float" || r.mode === "hidden" || r.mode === "popout" ? r.mode : null;
  const lastVisibleMode = r.lastVisibleMode === "dock" || r.lastVisibleMode === "float" ? r.lastVisibleMode : null;
  const sheet = r.sheet === "half" || r.sheet === "full" ? r.sheet : "peek";
  const pin = sanitizeRegion(r.pin);
  return {
    page: isFiniteNumber(r.page) && r.page >= 0 ? Math.floor(r.page) : 0,
    zoom: sanitizeZoom(r.zoom),
    center,
    rotations,
    mode,
    lastVisibleMode,
    pin,
    pinFollow: Boolean(pin) && r.pinFollow === true,
    sheet,
  };
}

function storageKey(id: string) {
  return `${STORAGE_PREFIX}${id}`;
}

function readSession(id: string): BillViewState {
  if (typeof window === "undefined" || !id) return { ...DEFAULT_VIEW };
  try {
    const raw = window.sessionStorage.getItem(storageKey(id));
    return raw ? sanitizeView(JSON.parse(raw)) : { ...DEFAULT_VIEW };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

function writeSession(id: string, view: BillViewState) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.sessionStorage.setItem(storageKey(id), JSON.stringify(view));
  } catch {
    // Storage full or blocked (private mode): the view still works for this render.
  }
}

/**
 * Reading state for one document. `id` may be empty while the document loads;
 * when it changes the stored state of the new document is loaded.
 */
export function useBillViewState(id: string) {
  const [state, setState] = useState<{ id: string; view: BillViewState }>(() => ({ id, view: readSession(id) }));
  const current = state.id === id ? state.view : null;
  const view = current ?? readSession(id);

  // Document switched: adopt its stored state.
  useEffect(() => {
    if (state.id !== id) setState({ id, view: readSession(id) });
  }, [id, state.id]);

  // Persist (debounced; pan updates can be frequent).
  useEffect(() => {
    if (!current || !state.id) return;
    const handle = window.setTimeout(() => writeSession(state.id, current), 120);
    return () => window.clearTimeout(handle);
  }, [current, state.id]);

  const update = useCallback(
    (patch: BillViewPatch) => {
      setState((prev) => {
        const base = prev.id === id ? prev.view : readSession(id);
        const delta = typeof patch === "function" ? patch(base) : patch;
        let changed = false;
        for (const key of Object.keys(delta) as Array<keyof BillViewState>) {
          if (!Object.is(base[key], delta[key])) {
            changed = true;
            break;
          }
        }
        if (!changed && prev.id === id) return prev;
        return { id, view: { ...base, ...delta } };
      });
    },
    [id],
  );

  return { view, update };
}

/* ------------------------------------------------------------------ */
/* Pop-out sync                                                        */
/* ------------------------------------------------------------------ */

export type BillSyncRole = "workspace" | "popout";

type SyncedFields = Pick<BillViewState, "page" | "zoom" | "rotations" | "pin">;

type SyncMessage =
  | ({ type: "view"; from: string } & SyncedFields)
  | { type: "hello"; from: string; role: BillSyncRole }
  | { type: "bye"; from: string; role: BillSyncRole }
  | { type: "ping"; from: string; role: BillSyncRole }
  | { type: "pong"; from: string; role: BillSyncRole }
  | { type: "bring-back"; from: string };

function syncedJson(view: SyncedFields) {
  return JSON.stringify({ page: view.page, zoom: view.zoom, rotations: view.rotations, pin: view.pin });
}

export function billChannelName(id: string) {
  return `bill-view-${id}`;
}

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Keeps page / zoom / rotation / pin in step with the other window of the same
 * document. Returns whether a peer of the opposite role is currently open and
 * helpers to ask the pop-out to close.
 */
export function useBillViewSync(
  id: string,
  role: BillSyncRole,
  view: BillViewState,
  update: (patch: BillViewPatch) => void,
  options: { enabled: boolean; onBringBack?: () => void },
) {
  const { enabled, onBringBack } = options;
  const channelRef = useRef<BroadcastChannel | null>(null);
  const selfRef = useRef<string>("");
  const lastSynced = useRef<string>("");
  const [peerOpen, setPeerOpen] = useState(false);
  const bringBackRef = useRef(onBringBack);
  bringBackRef.current = onBringBack;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!enabled || !id || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    if (!selfRef.current) selfRef.current = randomId();
    const self = selfRef.current;
    const channel = new BroadcastChannel(billChannelName(id));
    channelRef.current = channel;
    const peerRole: BillSyncRole = role === "workspace" ? "popout" : "workspace";
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object" || message.from === self) return;
      switch (message.type) {
        case "view": {
          const incoming = sanitizeView(message);
          const json = syncedJson(incoming);
          if (json === syncedJson(viewRef.current)) return;
          lastSynced.current = json;
          update({
            page: incoming.page,
            zoom: incoming.zoom,
            rotations: incoming.rotations,
            pin: incoming.pin,
            pinFollow: Boolean(incoming.pin),
            center: null,
          });
          return;
        }
        case "hello":
        case "pong":
          if (message.role === peerRole) {
            setPeerOpen(true);
            if (message.type === "hello") {
              // Tell the newcomer we are here and where we are reading.
              channel.postMessage({ type: "pong", from: self, role } satisfies SyncMessage);
              if (role === "workspace") channel.postMessage({ type: "view", from: self, ...pickSynced(viewRef.current) } satisfies SyncMessage);
            }
          }
          return;
        case "ping":
          if (message.role === peerRole) channel.postMessage({ type: "pong", from: self, role } satisfies SyncMessage);
          return;
        case "bye":
          if (message.role === peerRole) setPeerOpen(false);
          return;
        case "bring-back":
          if (role === "popout") bringBackRef.current?.();
          return;
      }
    };
    channel.postMessage({ type: role === "popout" ? "hello" : "ping", from: self, role } satisfies SyncMessage);
    const onHide = () => channel.postMessage({ type: "bye", from: self, role } satisfies SyncMessage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      try {
        channel.postMessage({ type: "bye", from: self, role } satisfies SyncMessage);
      } catch {
        // channel already closed
      }
      channel.close();
      channelRef.current = null;
      setPeerOpen(false);
    };
  }, [enabled, id, role, update]);

  // Broadcast local changes of the synced fields.
  const json = syncedJson(view);
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !enabled) return;
    if (json === lastSynced.current) return;
    lastSynced.current = json;
    channel.postMessage({ type: "view", from: selfRef.current, ...pickSynced(viewRef.current) } satisfies SyncMessage);
  }, [json, enabled]);

  const requestBringBack = useCallback(() => {
    channelRef.current?.postMessage({ type: "bring-back", from: selfRef.current } satisfies SyncMessage);
  }, []);

  return { peerOpen, requestBringBack };
}

function pickSynced(view: BillViewState): SyncedFields {
  return { page: view.page, zoom: view.zoom, rotations: view.rotations, pin: view.pin };
}

/* ------------------------------------------------------------------ */
/* Layout preferences (localStorage, never document content)          */
/* ------------------------------------------------------------------ */

export function readLocalJson<T>(key: string, fallback: T, validate: (value: unknown) => T | null): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return validate(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / privacy mode
  }
}

export const SPLIT_STORAGE_KEY = "bill-workspace:split-ratio";
export const FLOAT_STORAGE_KEY = "bill-workspace:float-geometry";
export const DEFAULT_SPLIT = 0.58;

/* ------------------------------------------------------------------ */
/* Media helpers                                                      */
/* ------------------------------------------------------------------ */

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

/** SSR-safe media query (server snapshot = `serverDefault`). */
export function useMediaQuery(query: string, serverDefault = false) {
  const subscribe = useCallback((callback: () => void) => subscribeMedia(query)(callback), [query]);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : serverDefault),
    () => serverDefault,
  );
}

export type DeviceClass = "phone" | "tablet" | "desktop";

export function useDeviceClass(): DeviceClass {
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const tablet = useMediaQuery("(min-width: 768px)", true);
  return desktop ? "desktop" : tablet ? "tablet" : "phone";
}

export function usePrefersReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)", false);
}
