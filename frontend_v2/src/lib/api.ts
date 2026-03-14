import axios, { AxiosError, AxiosRequestConfig } from "axios";
import Cookies from "js-cookie";

const isLocalHost = (host: string): boolean => {
    const normalized = String(host || "").trim().toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
};

const normalizeBase = (value: string): string => value.replace(/\/+$/, "");

const normalizeBrowserHost = (host: string): string => {
    const normalized = String(host || "").trim().toLowerCase();
    if (normalized === "0.0.0.0" || normalized === "::1") return "127.0.0.1";
    return normalized || "127.0.0.1";
};

const resolveLanBackendBase = (): string => {
    if (typeof window === "undefined") return "http://127.0.0.1:8000";
    const host = normalizeBrowserHost(String(window.location.hostname || ""));
    const protocol = String(window.location.protocol || "http:");
    const configuredPort = String(process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000";
    return `${protocol}//${host}:${configuredPort}`;
};

const resolveApiBase = (): string => {
    const envBase = String(process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
    if (envBase) {
        if (/^https?:\/\//i.test(envBase)) {
            // Guard against legacy localhost env config when accessed from another device on LAN.
            if (typeof window !== "undefined") {
                try {
                    const parsed = new URL(envBase);
                    const browserHost = normalizeBrowserHost(String(window.location.hostname || ""));
                    const parsedHost = normalizeBrowserHost(parsed.hostname);
                    if (isLocalHost(parsedHost) && parsedHost !== browserHost) {
                        const port = parsed.port || String(process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000";
                        return normalizeBase(`${window.location.protocol}//${browserHost}:${port}${parsed.pathname || ""}`);
                    }
                } catch {
                    // Fall through to default absolute base handling.
                }
            }
            return normalizeBase(envBase);
        }
        if (envBase.startsWith("/")) return normalizeBase(envBase);
    }

    if (typeof window !== "undefined") {
        const host = normalizeBrowserHost(String(window.location.hostname || ""));
        if (isLocalHost(host)) {
            const protocol = String(window.location.protocol || "http:");
            const port = String(process.env.NEXT_PUBLIC_API_PORT || "8000").trim() || "8000";
            // Keep API host aligned with UI host (localhost stays localhost, 127 stays 127).
            return normalizeBase(`${protocol}//${host}:${port}`);
        }

        // Local/LAN dev default: frontend on :3000, backend on :8000.
        // This prevents auth/API requests from incorrectly hitting the Next.js app on other devices.
        const port = String(window.location.port || "");
        if (port === "3000" || port === "3001") {
            return normalizeBase(resolveLanBackendBase());
        }

        // Fallback for proxy/same-origin deployments.
        return normalizeBase(window.location.origin);
    }
    return "http://127.0.0.1:8000";
};

const API_BASE = resolveApiBase();
export const RESOLVED_API_BASE = API_BASE;
const RETRY_HEADER = "x-codex-retried";

let refreshPromise: Promise<boolean> | null = null;
let loginRedirectIssued = false;
let csrfTokenCache: string | null = null;

const csrfClient = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    withCredentials: true,
});

const unsafeMethods = new Set(["post", "put", "patch", "delete"]);

const normalizeApiUrl = (url: string): string => {
    if (!url.startsWith("/api/")) return url;
    const [path, query] = url.split("?");
    const normalizedPath = path.endsWith("/") ? path : `${path}/`;
    return normalizedPath + (query ? `?${query}` : "");
};

export const getApiErrorStatus = (error: unknown): number | null => {
    const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
    const status = response?.status;
    return typeof status === "number" ? status : null;
};

const isAbsoluteUrl = (url: string): boolean => /^https?:\/\//i.test(url);

const shouldBypassRefresh = (url: string): boolean => {
    const normalized = String(url || "");
    return (
        normalized.includes("/api/users/token/refresh") ||
        normalized.includes("/api/users/login") ||
        normalized.includes("/api/users/logout") ||
        normalized.includes("/api/users/csrf")
    );
};

const isOnLoginRoute = (): boolean => {
    if (typeof window === "undefined") return false;
    const pathname = String(window.location.pathname || "").toLowerCase();
    return pathname === "/login" || pathname.startsWith("/login/");
};

const hasRetryHeader = (headers: AxiosRequestConfig["headers"]): boolean => {
    if (!headers) return false;
    const source = headers as Record<string, unknown> & { get?: (name: string) => unknown };
    if (typeof source.get === "function") {
        return String(source.get(RETRY_HEADER) ?? source.get(RETRY_HEADER.toLowerCase()) ?? "").trim() === "1";
    }
    const value = source[RETRY_HEADER] ?? source[RETRY_HEADER.toLowerCase()] ?? source["X-Codex-Retried"];
    return String(value ?? "").trim() === "1";
};

const markRetryHeader = (headers: AxiosRequestConfig["headers"]): void => {
    if (!headers) return;
    const target = headers as Record<string, unknown> & { set?: (name: string, value: string) => unknown };
    if (typeof target.set === "function") {
        target.set(RETRY_HEADER, "1");
        return;
    }
    target[RETRY_HEADER] = "1";
    target[RETRY_HEADER.toLowerCase()] = "1";
};

const redirectToLoginOnce = () => {
    if (typeof window === "undefined") return;
    if (isOnLoginRoute()) return;
    if (loginRedirectIssued) return;
    loginRedirectIssued = true;
    window.location.replace("/login");
};

const loadCsrfFromCookie = (): string | null => {
    if (typeof document === "undefined") return null;
    const pair = document.cookie
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("csrftoken="));
    if (!pair) return null;
    return decodeURIComponent(pair.split("=")[1] || "");
};

export const ensureCsrfToken = async (): Promise<string | null> => {
    if (csrfTokenCache) return csrfTokenCache;
    csrfTokenCache = loadCsrfFromCookie();
    if (csrfTokenCache) return csrfTokenCache;

    try {
        const { data } = await csrfClient.get("/api/users/csrf/");
        csrfTokenCache = String(data?.csrfToken || "").trim() || loadCsrfFromCookie();
        return csrfTokenCache || null;
    } catch {
        return null;
    }
};

const refreshSession = async (): Promise<boolean> => {
    const csrfToken = await ensureCsrfToken();
    try {
        await csrfClient.post(
            "/api/users/token/refresh/",
            {},
            csrfToken ? { headers: { "X-CSRFToken": csrfToken } } : undefined
        );
        return true;
    } catch {
        return false;
    }
};

const api = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
    },
});

api.interceptors.request.use(
    async (config) => {
        const rawUrl = String(config.url || "");
        if (rawUrl && isAbsoluteUrl(rawUrl)) {
            return Promise.reject(new Error("Absolute request URLs are not allowed. Use relative /api/... paths."));
        }

        if (rawUrl.startsWith("/api/")) {
            config.url = normalizeApiUrl(rawUrl);
        }

        config.headers = config.headers || {};

        const roleOverride = Cookies.get("x_role_override");
        if (roleOverride) {
            config.headers["X-Role-Override"] = roleOverride;
        }

        const method = String(config.method || "get").toLowerCase();
        if (unsafeMethods.has(method)) {
            const csrfToken = await ensureCsrfToken();
            if (csrfToken) {
                config.headers["X-CSRFToken"] = csrfToken;
            }
        }

        return config;
    },
    (error) => Promise.reject(error)
);

api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = (error?.config || {}) as AxiosRequestConfig & { _retry?: boolean };
        const status = error?.response?.status;
        const requestUrl = String(originalRequest?.url || "");

        if (status === 401) {
            if (shouldBypassRefresh(requestUrl)) {
                redirectToLoginOnce();
                return Promise.reject(error);
            }

            if (originalRequest._retry || hasRetryHeader(originalRequest.headers)) {
                redirectToLoginOnce();
                return Promise.reject(error);
            }

            originalRequest._retry = true;
            originalRequest.headers = originalRequest.headers || {};
            markRetryHeader(originalRequest.headers);

            if (!refreshPromise) {
                refreshPromise = refreshSession().finally(() => {
                    refreshPromise = null;
                });
            }
            const ok = await refreshPromise;
            if (!ok) {
                redirectToLoginOnce();
                return Promise.reject(error);
            }

            if (typeof originalRequest.url === "string") {
                if (isAbsoluteUrl(originalRequest.url)) {
                    return Promise.reject(new Error("Absolute request URLs are not allowed. Use relative /api/... paths."));
                }
                originalRequest.url = normalizeApiUrl(originalRequest.url);
            }
            return api(originalRequest);
        }

        return Promise.reject(error);
    }
);

export { api };
