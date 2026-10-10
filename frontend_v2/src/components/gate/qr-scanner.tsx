"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, TriangleAlert } from "lucide-react";

import { GateAction } from "./gate-ui";

/*
 * Live QR scanning for the watchman. Uses the browser's native BarcodeDetector
 * when it supports QR (Android Chrome), otherwise decodes frames with jsQR
 * (pinned dependency, loaded only when needed). When live camera access is
 * unavailable (insecure LAN origin, permission refused, iOS in-app browsers)
 * a still photo of the code is decoded instead. Nothing is uploaded here: the
 * caller sends the raw text to the server, which verifies the signature.
 */

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
type DetectorCtor = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

const SCAN_INTERVAL_MS = 220;
const SAME_CODE_COOLDOWN_MS = 2500;
const FRAME_EDGE = 720;

async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;

let jsQrPromise: Promise<JsQr> | null = null;
function loadJsQr(): Promise<JsQr> {
  if (!jsQrPromise) {
    jsQrPromise = import("jsqr").then((mod) => (mod.default ?? mod) as unknown as JsQr);
  }
  return jsQrPromise;
}

/** Decode one image source (video frame or photo) with the best available decoder. */
async function decodeSource(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement, detector: Detector | null): Promise<string | null> {
  if (detector) {
    try {
      const found = await detector.detect(source);
      const value = found.find((row) => row.rawValue)?.rawValue;
      if (value) return value;
    } catch {
      // Fall through to jsQR for this frame.
    }
  }
  const scale = Math.min(1, FRAME_EDGE / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = await loadJsQr();
  return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export function QrScanner({ onCode, onClose }: { onCode: (raw: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [phase, setPhase] = useState<"starting" | "live" | "fallback">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [decodingPhoto, setDecodingPhoto] = useState(false);

  const emit = useCallback((raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const now = Date.now();
    if (lastRef.current.value === value && now - lastRef.current.at < SAME_CODE_COOLDOWN_MS) return;
    lastRef.current = { value, at: now };
    try {
      navigator.vibrate?.(60);
    } catch {
      // Vibration is optional.
    }
    setFlash(value);
    window.setTimeout(() => setFlash((current) => (current === value ? null : current)), 1200);
    onCodeRef.current(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    canvasRef.current = canvasRef.current ?? document.createElement("canvas");

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        setPhase("fallback");
        setMessage("Live scanning is not available in this browser. Take a photo of the QR code instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (error) {
        if (cancelled) return;
        const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
        setPhase("fallback");
        setMessage(denied ? "Camera permission was refused. Allow the camera for this site, or take a photo of the QR code instead." : "The camera could not start. Take a photo of the QR code instead.");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay with a muted inline video normally succeeds; scanning still works on the next frame.
      }
      const detector = await nativeDetector();
      setPhase("live");
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= 2 && video.videoWidth > 0 && canvasRef.current) {
          try {
            const value = await decodeSource(video, video.videoWidth, video.videoHeight, canvasRef.current, detector);
            if (value) emit(value);
          } catch {
            // A failed frame is ignored; the next frame retries.
          }
        }
        if (!cancelled) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    };
    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [emit]);

  const decodePhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setDecodingPhoto(true);
    setMessage(null);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      try {
        const value = await decodeSource(bitmap, bitmap.width, bitmap.height, canvasRef.current ?? document.createElement("canvas"), await nativeDetector());
        if (value) emit(value);
        else setMessage("No QR code was found in that photo. Hold the phone closer so the code fills the middle of the photo.");
      } finally {
        bitmap.close();
      }
    } catch {
      setMessage("That photo could not be read. Please try again.");
    } finally {
      setDecodingPhoto(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[22px] bg-black" style={{ aspectRatio: "3 / 4", maxHeight: "60dvh" }}>
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Camera view for scanning the QR code" />
        {phase === "live" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div className="h-[62%] w-[62%] rounded-3xl border-4 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        ) : null}
        {phase === "starting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-[14px]">Starting camera…</span>
          </div>
        ) : null}
        {phase === "fallback" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/90">
            <ScanLine className="h-10 w-10" />
            <span className="text-[14px]">Take a clear photo of the QR code.</span>
          </div>
        ) : null}
        {flash ? (
          <div role="status" className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/95 px-4 py-3 text-center text-[14px] font-semibold text-content-1">
            Code read — checking…
          </div>
        ) : null}
      </div>
      {phase === "live" ? <p className="px-1 text-center text-[13px] text-content-3">Point the camera at the QR code on the paper. It reads automatically.</p> : null}
      {message ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border px-4 py-3 text-[14px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)", color: "var(--content-2)" }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--gate-pending)" }} /> {message}
        </p>
      ) : null}
      <input
        ref={photoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void decodePhoto(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <GateAction tone="plain" size="md" busy={decodingPhoto} onClick={() => photoRef.current?.click()}>
          <Camera className="h-5 w-5" /> Photo of QR
        </GateAction>
        <GateAction tone="out" size="md" onClick={onClose}>
          Done
        </GateAction>
      </div>
    </div>
  );
}
