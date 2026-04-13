"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { useRouter, usePathname } from "next/navigation";
import { api, ensureCsrfToken, refreshSessionCookie } from "@/lib/api";
import { getLandingPage, ROLE_LANDING_PAGES } from "@/lib/roles";
import { systemUserService } from "@/services/system-users";

interface User {
    id: string; // Changed from number to string for UUID
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    avatar_url?: string;
    email_missing?: boolean;
    role_info?: { id: string; code: string; name: string };
    full_name: string;
    is_owner: boolean;
    extra_permissions?: string[];
    entitlements?: {
        role: string;
        landing_page: string;
        permissions: string[];
        permission_map?: Record<string, string[]>;
        module_permissions?: Array<{ module: string; actions: string[] }>;
        extra_overrides?: string[];
        context?: {
            work_centers: string[];
            machines: string[];
        };
    }
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    effectiveRole: string | null;
    login: (user: User) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_IDLE_WINDOW_MS = 20 * 60 * 1000;
const SESSION_KEEPALIVE_INTERVAL_MS = 60 * 1000;
const SESSION_KEEPALIVE_GRACE_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [effectiveRole, setEffectiveRole] = useState<string | null>(null);
    const lastActivityAtRef = useRef<number>(Date.now());
    const lastRefreshAtRef = useRef<number>(Date.now());
    const router = useRouter();
    const pathname = usePathname();

    const hydrateSession = useCallback(async (options?: { attempts?: number; clearOnFailure?: boolean }) => {
        const attempts = Math.max(1, Number(options?.attempts ?? 5));
        const clearOnFailure = options?.clearOnFailure ?? true;
        await ensureCsrfToken();

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const { data } = await api.get<User>("/api/users/me");
                setUser(data);
                setEffectiveRole(getEffectiveRole(data));
                lastRefreshAtRef.current = Date.now();
                return data;
            } catch (error) {
                if (attempt < attempts - 1) {
                    await ensureCsrfToken().catch(() => undefined);
                    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                }
            }
        }

        if (clearOnFailure) {
            setUser(null);
            setEffectiveRole(null);
        }
        return null;
    }, []);

    // Get the effective role considering role override
    const getEffectiveRole = (userData: User | null): string | null => {
        if (!userData) return null;
        
        // Check for role override cookie
        const roleOverride = Cookies.get("x_role_override");
        if (roleOverride) {
            return roleOverride;
        }
        
        // Fall back to user's primary role
        return userData.role_info?.code || null;
    };

    useEffect(() => {
        const initAuth = async () => {
            const initialPath = typeof window !== "undefined" ? String(window.location.pathname || "").toLowerCase() : "";
            if (initialPath === "/login" || initialPath.startsWith("/login/")) {
                await ensureCsrfToken();
                await hydrateSession({ attempts: 1, clearOnFailure: false });
                setLoading(false);
                return;
            }

            try {
                await hydrateSession();
            } finally {
                setLoading(false);
            }
        };

        initAuth();
    }, [hydrateSession]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const markActive = () => {
            lastActivityAtRef.current = Date.now();
        };

        const events: Array<keyof WindowEventMap> = [
            "pointerdown",
            "keydown",
            "touchstart",
            "mousemove",
            "scroll",
            "focus",
        ];

        events.forEach((eventName) => window.addEventListener(eventName, markActive, { passive: true }));
        document.addEventListener("visibilitychange", markActive);

        return () => {
            events.forEach((eventName) => window.removeEventListener(eventName, markActive));
            document.removeEventListener("visibilitychange", markActive);
        };
    }, []);

    useEffect(() => {
        const currentPath = String(pathname || "").toLowerCase();
        if (loading) return;
        if (!currentPath || currentPath === "/login" || currentPath.startsWith("/login/")) return;
        if (user) return;

        let cancelled = false;
        const rehydrate = async () => {
            setLoading(true);
            const hydratedUser = await hydrateSession();
            if (cancelled) return;
            setLoading(false);
            if (!hydratedUser) {
                router.replace("/login");
            }
        };

        rehydrate();
        return () => {
            cancelled = true;
        };
    }, [loading, pathname, router, user]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (loading || !user) return;
        const currentPath = String(pathname || "").toLowerCase();
        if (currentPath === "/login" || currentPath.startsWith("/login/")) return;

        let cancelled = false;
        const keepalive = async () => {
            const now = Date.now();
            const idleFor = now - lastActivityAtRef.current;
            const refreshedAgo = now - lastRefreshAtRef.current;
            if (idleFor >= SESSION_IDLE_WINDOW_MS) return;
            if (refreshedAgo < SESSION_KEEPALIVE_GRACE_MS) return;

            const ok = await refreshSessionCookie();
            if (cancelled) return;
            if (ok) {
                lastRefreshAtRef.current = Date.now();
                return;
            }

            setUser(null);
            setEffectiveRole(null);
            router.replace("/login");
        };

        const interval = window.setInterval(() => {
            void keepalive();
        }, SESSION_KEEPALIVE_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [loading, pathname, router, user]);

    // Watch for role override changes
    useEffect(() => {
        if (user) {
            const handleRoleOverrideChange = () => {
                const role = getEffectiveRole(user);
                setEffectiveRole(role);
            };
            
            // Check for role override changes periodically
            const interval = setInterval(handleRoleOverrideChange, 1000);
            return () => clearInterval(interval);
        }
    }, [user]);

    const getLandingPageForUser = (userData: User, resolvedRole?: string | null): string => {
        // Use backend landing_page if available, but guard against legacy/non-existent paths.
        const entitlementLanding = userData.entitlements?.landing_page;
        if (entitlementLanding) {
            const landing = entitlementLanding.startsWith("/") ? entitlementLanding : `/${entitlementLanding}`;

            // Legacy aliases (older backend / UI used these).
            if (landing === "/dashboard/super-admin") return "/dashboard/admin";

            // Only allow known top-level route families.
            const isValidRoute = Object.values(ROLE_LANDING_PAGES).includes(landing);
            if (isValidRoute) {
                return landing;
            }
        }

        // Use the effective role (considering override) for landing page
        const role = resolvedRole || effectiveRole || userData.role_info?.code;
        return getLandingPage(role);
    };

    const login = async (userData: User) => {
        setLoading(true);

        const hydratedUser = await hydrateSession({ attempts: 3, clearOnFailure: false });
        const resolvedUser = hydratedUser || userData || null;

        if (!resolvedUser) {
            setUser(null);
            setEffectiveRole(null);
            setLoading(false);
            startTransition(() => {
                router.replace("/login");
                router.refresh();
            });
            return;
        }

        setUser(resolvedUser);
        const role = getEffectiveRole(resolvedUser);
        setEffectiveRole(role);
        lastActivityAtRef.current = Date.now();
        lastRefreshAtRef.current = Date.now();
        setLoading(false);

        const landing = getLandingPageForUser(resolvedUser, role);
        startTransition(() => {
            router.replace(landing);
            router.refresh();
        });
    };

    const logout = async () => {
        try {
            await systemUserService.logout();
        } catch {
            // Always clear local session even if server-side logout fails.
        }
        Cookies.remove("x_role_override"); // Also remove role override on logout
        setUser(null);
        setEffectiveRole(null);
        router.replace("/login");
    };

    useEffect(() => {
        const currentPath = String(pathname || "").toLowerCase();
        if (!loading && user && (currentPath === "/login" || currentPath.startsWith("/login/"))) {
            const landing = getLandingPageForUser(user);
            router.replace(landing);
        }
    }, [effectiveRole, user, loading, pathname, router]);


    return (
        <AuthContext.Provider value={{ user, loading, effectiveRole, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
