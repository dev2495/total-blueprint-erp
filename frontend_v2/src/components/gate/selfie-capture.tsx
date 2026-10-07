"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { GateAction, GateSheet } from "./gate-ui";

const MAX_EDGE = 720;
const TARGET_BYTES = 900 * 1024;
const HARD_LIMIT_BYTES = 3 * 1024 * 1024;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/** Resize to ≤720px on the long edge and re-encode JPEG under ~900 KB. Strips EXIF/location. */
async function compressSource(source: CanvasImageSource, width: number, height: number, mirror: boolean): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Camera image could not be processed on this phone.");
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.84;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob && blob.size > TARGET_BYTES && quality > 0.5) {
    quality -= 0.08;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (!blob) throw new Error("Camera image could not be processed on this phone.");
  if (blob.size > HARD_LIMIT_BYTES) throw new Error("Photo is too large. Please retake it.");
  return blob;
}

async function compressFile(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error("Please choose a photo.");
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    try {
      return await compressSource(bitmap, bitmap.width, bitmap.height, false);
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This photo could not be opened."));
      el.src = url;
    });
    return await compressSource(img, img.naturalWidth, img.naturalHeight, false);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function liveCameraSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== "undefined" && window.isSecureContext;
}

/**
 * Quick selfie: live front camera with a big shutter where the browser allows
 * it, otherwise the phone's own camera via file capture. The photo exists only
 * in memory (a Blob + object URL) and is released on retake/unmount.
 */
export function SelfieCapture({
  value,
  onChange,
  disabled,
  label = "Take selfie",
}: {
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const start = () => {
    setError(null);
    if (liveCameraSupported()) setCameraOpen(true);
    else fileRef.current?.click();
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await compressFile(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo could not be used.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onFile}
      />
      {preview ? (
        <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your selfie" className="h-24 w-24 rounded-2xl object-cover" />
          <div className="grid flex-1 gap-2">
            <GateAction tone="plain" size="md" onClick={start} disabled={disabled}>
              <RotateCcw className="h-5 w-5" /> Retake
            </GateAction>
            <GateAction tone="plain" size="md" onClick={() => onChange(null)} disabled={disabled}>
              <Trash2 className="h-5 w-5" /> Remove
            </GateAction>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <GateAction tone="ink" onClick={start} disabled={disabled} busy={busy} className="w-full">
            <Camera className="h-5 w-5" /> {label}
          </GateAction>
          {liveCameraSupported() ? (
            <button
              type="button"
              className="min-h-[44px] text-[14px] font-medium text-content-3 underline-offset-4 hover:underline"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
            >
              <ImageUp className="mr-1.5 inline h-4 w-4" />
              Use phone camera app instead
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] font-medium text-[var(--gate-alert)]">
          {error}
        </p>
      ) : null}
      <CameraSheet
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCaptured={(blob) => {
          onChange(blob);
          setCameraOpen(false);
        }}
        onFallback={() => {
          setCameraOpen(false);
          fileRef.current?.click();
        }}
      />
    </div>
  );
}

function CameraSheet({
  open,
  onOpenChange,
  onCaptured,
  onFallback,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCaptured: (blob: Blob) => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "denied" | "error">("starting");
  const [capturing, setCapturing] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    setState("starting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setState("live");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setCapturing(true);
    try {
      const blob = await compressSource(video, video.videoWidth, video.videoHeight, true);
      stop();
      onCaptured(blob);
    } catch {
      setState("error");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <GateSheet open={open} onOpenChange={onOpenChange} title="Take selfie" description="Face the camera in good light.">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[360px] overflow-hidden rounded-[22px] bg-[var(--gate-ink)]">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)", opacity: state === "live" ? 1 : 0 }}
        />
        <div className="pointer-events-none absolute inset-[14%] rounded-[50%] border-2 border-dashed border-white/50" aria-hidden />
        {state !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[14px] text-white/90">
            {state === "starting" ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" /> Opening camera…
              </>
            ) : state === "denied" ? (
              <>Camera permission was blocked. You can use the phone camera app instead.</>
            ) : (
              <>The camera could not start on this phone.</>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2">
        {state === "live" ? (
          <GateAction tone="ink" onClick={() => void shoot()} busy={capturing} className="w-full">
            <Camera className="h-5 w-5" /> Capture
          </GateAction>
        ) : state === "starting" ? null : (
          <GateAction tone="ink" onClick={onFallback} className="w-full">
            <ImageUp className="h-5 w-5" /> Use phone camera app
          </GateAction>
        )}
      </div>
    </GateSheet>
  );
}
