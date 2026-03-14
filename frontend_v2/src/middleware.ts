import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

function buildNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function appendOrigin(sources: Set<string>, value?: string) {
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.origin && parsed.origin !== "null") {
      sources.add(parsed.origin);
    }
  } catch {
    // Ignore non-absolute values such as same-origin relative paths.
  }
}

function inferBackendOrigins(request: NextRequest) {
  const sources = new Set<string>();
  const protocol = request.nextUrl.protocol || "http:";
  const apiPort = String(process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000";
  const hostname = String(request.nextUrl.hostname || "").trim().toLowerCase();

  if (!hostname) return sources;

  const hosts = new Set<string>([hostname]);
  if (hostname === "localhost") hosts.add("127.0.0.1");
  if (hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") hosts.add("localhost");

  for (const host of hosts) {
    sources.add(`${protocol}//${host}:${apiPort}`);
  }

  return sources;
}

function buildContentSecurityPolicy(nonce: string, request: NextRequest) {
  const connectSources = new Set<string>(["'self'"]);
  appendOrigin(connectSources, process.env.NEXT_PUBLIC_API_BASE_URL);
  appendOrigin(connectSources, process.env.NEXT_PUBLIC_SENTRY_DSN);
  for (const origin of inferBackendOrigins(request)) {
    connectSources.add(origin);
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${Array.from(connectSources).join(" ")}`,
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, csp?: string) {
  if (csp) {
    response.headers.set("Content-Security-Policy", csp);
  }
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
}

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  const nonce = buildNonce();
  const csp = buildContentSecurityPolicy(nonce, request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-nonce", nonce);
  applySecurityHeaders(response, csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
