import axios, { AxiosError, AxiosRequestConfig } from "axios";
import Cookies from "js-cookie";

const normalizeBase = (value: string): string => value.replace(/\/+$/, "");

const resolveApiBase = (): string => {
    if (typeof window !== "undefined") {
        return "";
    }

    const envBase = String(
        process.env.UI_API_BASE_URL ||
        process.env.API_PROXY_TARGET ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        ""
    ).trim();
    if (envBase) {
        if (/^https?:\/\//i.test(envBase)) {
            return normalizeBase(envBase);
        }
        if (envBase.startsWith("/")) return normalizeBase(envBase);
    }
    return "http://127.0.0.1:8000";
};

const API_BASE = resolveApiBase();
export const RESOLVED_API_BASE = API_BASE || "/";
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

const flattenApiErrorValue = (value: unknown, fieldLabel?: string): string[] => {
    if (value === null || value === undefined || value === "") return [];

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const message = String(value).trim();
        if (!message) return [];
        return [fieldLabel ? `${fieldLabel}: ${message}` : message];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => flattenApiErrorValue(item, fieldLabel));
    }

    if (typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
            const normalizedLabel = key === "non_field_errors"
                ? fieldLabel
                : key.replace(/_/g, " ");
            return flattenApiErrorValue(nested, normalizedLabel);
        });
    }

    return [];
};

const errorFieldBlacklist = new Set([
    "status",
    "code",
    "message",
    "count",
    "request_id",
    "results",
    "data",
    "detail",
    "error",
]);

const genericErrorMessages = new Set([
    "Request failed.",
    "Bad request.",
    "An error occurred.",
]);

export const extractApiErrorMap = (error: unknown): Record<string, string> => {
    const payload = (error as AxiosError<{ detail?: unknown; error?: unknown; message?: unknown }> | undefined)?.response?.data;
    if (!payload || typeof payload !== "object") return {};

    const source = payload && typeof payload.detail === "object" && payload.detail !== null
        ? payload.detail as Record<string, unknown>
        : payload as Record<string, unknown>;

    return Object.entries(source).reduce<Record<string, string>>((acc, [key, value]) => {
        if (errorFieldBlacklist.has(key)) return acc;
        const messages = flattenApiErrorValue(value).map((message) => String(message).trim()).filter(Boolean);
        if (messages.length > 0) {
            acc[key] = Array.from(new Set(messages)).join(" • ");
        }
        return acc;
    }, {});
};

export const describeApiError = (error: unknown, fallback = "Request failed."): string => {
    const axiosError = error as AxiosError<{ detail?: unknown; error?: unknown; message?: unknown }> | undefined;
    const payload = axiosError?.response?.data;

    const messages = [
        ...flattenApiErrorValue(payload?.detail),
        ...flattenApiErrorValue(payload?.error),
        ...flattenApiErrorValue(payload?.message),
    ].filter(Boolean);

    const fieldMessages = Object.values(extractApiErrorMap(error));
    const uniqueMessages = Array.from(
        new Set(
            [...messages, ...fieldMessages]
                .map((message) => String(message).trim())
                .filter(Boolean)
                .filter((message) => !(fieldMessages.length > 0 && genericErrorMessages.has(message)))
        )
    );
    if (uniqueMessages.length > 0) {
        return uniqueMessages.join(" • ");
    }

    const rawMessage = String(axiosError?.message || "").trim();
    if (rawMessage) return rawMessage;
    return fallback;
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
    return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/admin-login" || pathname.startsWith("/admin-login/");
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

export const refreshSessionCookie = async (): Promise<boolean> => {
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
                refreshPromise = refreshSessionCookie().finally(() => {
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

        const normalizedMessage = describeApiError(error, String(error?.message || "").trim() || "Request failed.");
        if (normalizedMessage) {
            error.message = normalizedMessage;
        }

        return Promise.reject(error);
    }
);

export { api };
