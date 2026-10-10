"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Cookies from "js-cookie";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  ClipboardList,
  History,
  Home,
  Settings,
  LayoutGrid,
  LogOut,
  MapPin,
  QrCode,
  ShieldAlert,
  Users,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getCanonicalRoleCode, getLandingPage } from "@/lib/roles";
import { gateApi, type GatePlant } from "@/services/gate";
import { canLogAtGate, canReviewGateBills, canSubmitGateBills, canViewGateReports, isGateOwner, isWatchmanUser } from "./gate-access";
import { GateMark } from "./gate-ui";

type GateContextValue = {
  plants: GatePlant[];
  plant: GatePlant | null;
  plantId: string;
  setPlantId: (id: string) => void;
  isOwner: boolean;
  isWatchman: boolean;
  canLog: boolean;
  canReports: boolean;
  /** Record a bill-photo arrival (watchman or master). */
  canSubmitBills: boolean;
  /** Photograph papers leaving the gate (watchman or master; gate.outward.submit). */
  canSubmitOutward: boolean;
  /** Inventory gate-bill queue / receiving (explicit backend entitlement). */
  canReviewBills: boolean;
  operatorName: string;
};

const GateContext = createContext<GateContextValue | null>(null);
const PLANT_PREF_KEY = "tpp.gate.plant";

export function useGate() {
  const value = useContext(GateContext);
  if (!value) throw new Error("useGate must be used inside the gate shell");
  return value;
}

function readPlantPref(): string {
  try {
    return window.localStorage.getItem(PLANT_PREF_KEY) || "";
  } catch {
    return "";
  }
}

function writePlantPref(id: string) {
  try {
    window.localStorage.setItem(PLANT_PREF_KEY, id);
  } catch {
    // Preference only; the shell works without storage.
  }
}

export function GateShell({ children }: { children: React.ReactNode }) {
  const { user, loading, effectiveRole } = useAuth();

  if (loading || !user) return <GateShellSkeleton />;

  const isWatchman = isWatchmanUser(user, effectiveRole);
  const canLog = canLogAtGate(user, effectiveRole);
  const isOwner = isGateOwner(user, effectiveRole);
  const canReports = canViewGateReports(user, effectiveRole);

  if (!canLog && !isOwner) {
    return (
      <GateBlocked
        title="No gate access"
        body="Your account is not set up for the gate terminal. Ask an administrator or owner to assign the Watchman role or gate access."
        showErpLink={!isWatchman}
      />
    );
  }

  return (
    <GatePlantScope isWatchman={isWatchman} isOwner={isOwner} canLog={canLog} canReports={canReports}>
      {children}
    </GatePlantScope>
  );
}

function GatePlantScope({
  children,
  isWatchman,
  isOwner,
  canLog,
  canReports,
}: {
  children: React.ReactNode;
  isWatchman: boolean;
  isOwner: boolean;
  canLog: boolean;
  canReports: boolean;
}) {
  const { user, effectiveRole } = useAuth();
  const plantsQuery = useQuery({
    queryKey: ["gate", "plants"],
    queryFn: () => gateApi.masters({}),
    select: (data) => data.plants,
    staleTime: 5 * 60_000,
    retry: (count, error) => getApiErrorStatus(error) !== 403 && count < 2,
    meta: { suppressGlobalError: true },
  });
  const plants = useMemo(() => plantsQuery.data ?? [], [plantsQuery.data]);
  const [plantId, setPlantIdState] = useState("");

  useEffect(() => {
    if (!plants.length) return;
    if (plantId && plants.some((p) => p.id === plantId)) return;
    const pref = readPlantPref();
    setPlantIdState(plants.some((p) => p.id === pref) ? pref : plants[0].id);
  }, [plants, plantId]);

  const value = useMemo<GateContextValue>(
    () => ({
      plants,
      plant: plants.find((p) => p.id === plantId) ?? null,
      plantId,
      setPlantId: (id: string) => {
        setPlantIdState(id);
        writePlantPref(id);
      },
      isOwner,
      isWatchman,
      canLog,
      canReports,
      canSubmitBills: canSubmitGateBills(user, effectiveRole),
      canSubmitOutward: canSubmitGateBills(user, effectiveRole),
      canReviewBills: canReviewGateBills(user, effectiveRole),
      operatorName: user?.first_name || user?.full_name || user?.username || "",
    }),
    [plants, plantId, isOwner, isWatchman, canLog, canReports, user, effectiveRole],
  );

  if (plantsQuery.isLoading) return <GateShellSkeleton />;

  if (plantsQuery.isError) {
    const status = getApiErrorStatus(plantsQuery.error);
    if (status === 403) {
      return (
        <GateBlocked
          title="Gate not assigned"
          body="Your account has no gate assigned yet, so the register is locked. Ask an administrator or owner to assign your plant gate in User Management, then sign in again."
          showErpLink={!isWatchman}
        />
      );
    }
    return (
      <GateBlocked
        title="Gate server not reachable"
        body="Check the phone's internet connection, then try again. Nothing has been recorded."
        retry={() => plantsQuery.refetch()}
        showErpLink={!isWatchman}
      />
    );
  }

  if (!plants.length) {
    return (
      <GateBlocked
        title="Gate not assigned"
        body={
          isWatchman
            ? "No plant gate is assigned to your account, so the register is locked. Ask an administrator or owner to assign your gate in User Management."
            : "No active plant is available for the gate register."
        }
        showErpLink={!isWatchman}
      />
    );
  }

  return (
    <GateContext.Provider value={value}>
      <div className="gate-canvas min-h-[100dvh]">
        <GateTopBar />
        <main className="gate-main mx-auto w-full max-w-[1180px] px-4 pb-28 pt-4 sm:px-6 lg:pb-12">{children}</main>
        {canLog ? <GateTabBar /> : null}
      </div>
    </GateContext.Provider>
  );
}

function GateTopBar() {
  const { plants, plant, setPlantId, isOwner, isWatchman, canReports, operatorName } = useGate();
  const { logout } = useAuth();
  const router = useRouter();

  return (
    <header
      className="gate-no-print sticky top-0 z-40 text-[var(--text-on-dark)]"
      style={{ background: "var(--gate-ink)", paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-[60px] w-full max-w-[1180px] items-center gap-3 px-4 sm:px-6">
        <Link href="/gate" className="flex min-h-[44px] items-center gap-2.5" aria-label="Gate home">
          <GateMark className="h-7 w-8" />
          <div className="whitespace-nowrap leading-tight">
            <div className="hidden text-[11px] font-semibold uppercase tracking-[0.14em] sm:block" style={{ color: "var(--gate-ink-muted)" }}>
              Total Poly Print
            </div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">Gate</div>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {plants.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="gate-press flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
                  style={{ background: "var(--gate-ink-2)" }}
                  aria-label="Change gate plant"
                >
                  <MapPin className="h-4 w-4 opacity-80" />
                  <span className="max-w-[120px] truncate sm:max-w-[200px]">{plant?.name ?? "Plant"}</span>
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                <DropdownMenuLabel>Gate plant</DropdownMenuLabel>
                {plants.map((p) => (
                  <DropdownMenuItem key={p.id} className="min-h-[44px]" onSelect={() => setPlantId(p.id)}>
                    <span className="flex-1">{p.name}</span>
                    <span className="font-mono text-[11px] text-content-4">{p.code}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span
              className="flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
              style={{ background: "var(--gate-ink-2)" }}
            >
              <MapPin className="h-4 w-4 opacity-80" />
              <span className="max-w-[140px] truncate sm:max-w-[220px]">{plant?.name}</span>
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="gate-press flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-bold uppercase"
                style={{ background: "var(--gate-ink-2)" }}
                aria-label="Account menu"
              >
                {(operatorName || "?").slice(0, 1)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[230px]">
              <DropdownMenuLabel className="font-normal">
                <div className="text-[13px] font-semibold text-content-1">{operatorName}</div>
                <div className="text-[12px] text-content-3">{isWatchman ? "Watchman" : isOwner ? "Admin / Owner · full gate access" : "Gate access"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isOwner ? (
                <>
                  <DropdownMenuItem className="min-h-[44px]" onSelect={() => router.push("/gate/setup")}>
                    <Settings className="mr-2 h-4 w-4" /> Gate setup
                  </DropdownMenuItem>
                  <DropdownMenuItem className="min-h-[44px]" onSelect={() => router.push("/gate/history")}>
                    <History className="mr-2 h-4 w-4" /> Gate history
                  </DropdownMenuItem>
                  <DropdownMenuItem className="min-h-[44px]" onSelect={() => router.push("/gate/qr")}>
                    <QrCode className="mr-2 h-4 w-4" /> Visitor QR poster
                  </DropdownMenuItem>
                </>
              ) : null}
              {canReports ? (
                <DropdownMenuItem className="min-h-[44px]" onSelect={() => router.push("/analytics/reports/gate")}>
                  <BarChart3 className="mr-2 h-4 w-4" /> Gate report
                </DropdownMenuItem>
              ) : null}
              {!isWatchman ? (
                <DropdownMenuItem className="min-h-[44px]" onSelect={() => router.push("/dashboard")}>
                  <LayoutGrid className="mr-2 h-4 w-4" /> Back to ERP
                </DropdownMenuItem>
              ) : null}
              {!isWatchman || isOwner ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem className="min-h-[44px] text-danger-fg" onSelect={() => void logout()}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

const TABS = [
  { href: "/gate", label: "Gate", icon: Home, match: (p: string) => p === "/gate" },
  { href: "/gate/goods", label: "Goods", icon: ArrowLeftRight, match: (p: string) => p.startsWith("/gate/goods") || p.startsWith("/gate/inward-bills") || p.startsWith("/gate/outward") },
  { href: "/gate/visitors", label: "Visitors", icon: Users, match: (p: string) => p.startsWith("/gate/visitors") },
  { href: "/gate/register", label: "Today", icon: ClipboardList, match: (p: string) => p.startsWith("/gate/register") },
];

function GateTabBar() {
  const pathname = usePathname() || "/gate";
  return (
    <nav
      aria-label="Gate sections"
      className="gate-no-print gate-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/95 backdrop-blur-xl lg:static lg:mx-auto lg:mb-6 lg:max-w-[560px] lg:rounded-full lg:border lg:pb-0"
    >
      <ul className="mx-auto grid max-w-[560px] grid-cols-4 px-2 pt-1.5 lg:py-1">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "gate-press flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl text-[12px] font-semibold",
                  active ? "text-content-1" : "text-content-3",
                )}
              >
                <span
                  className="flex h-8 w-14 items-center justify-center rounded-full transition-colors"
                  style={active ? { background: "var(--gate-in-soft)", color: "var(--gate-in)" } : undefined}
                >
                  <Icon className="h-[20px] w-[20px]" />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function GateShellSkeleton() {
  return (
    <div className="gate-canvas min-h-[100dvh]">
      <div className="h-[60px]" style={{ background: "var(--gate-ink)" }} />
      <div className="mx-auto max-w-[1180px] space-y-3 px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="gate-card h-[132px] animate-pulse" />
          <div className="gate-card h-[132px] animate-pulse" />
        </div>
        <div className="gate-card h-[88px] animate-pulse" />
        <div className="gate-card h-[220px] animate-pulse" />
      </div>
    </div>
  );
}

export function GateBlocked({
  title,
  body,
  retry,
  showErpLink,
}: {
  title: string;
  body: string;
  retry?: () => void;
  showErpLink?: boolean;
}) {
  const { logout, user } = useAuth();
  // An administrator previewing the Watchman role is held by the watchman
  // ceiling; give them a way back without signing out.
  const actualRole = getCanonicalRoleCode(user?.role_info?.code);
  const previewingWatchman = actualRole !== "WATCHMAN" && Boolean(Cookies.get("x_role_override"));
  const exitPreview = () => {
    Cookies.remove("x_role_override");
    window.location.href = getLandingPage(actualRole) || "/";
  };
  return (
    <div className="gate-canvas flex min-h-[100dvh] items-center justify-center px-5">
      <div className="gate-card w-full max-w-[420px] p-6 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "var(--gate-pending-soft)", color: "var(--gate-pending)" }}
        >
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-content-1">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-content-3 [text-wrap:pretty]">{body}</p>
        <div className="mt-6 grid gap-2">
          {previewingWatchman ? (
            <button
              type="button"
              onClick={exitPreview}
              className="gate-press min-h-[52px] rounded-2xl text-[15px] font-semibold text-white"
              style={{ background: "var(--gate-ink-2)" }}
            >
              Exit role preview
            </button>
          ) : null}
          {retry ? (
            <button
              type="button"
              onClick={retry}
              className="gate-press min-h-[52px] rounded-2xl text-[15px] font-semibold text-white"
              style={{ background: "var(--gate-in)" }}
            >
              Try again
            </button>
          ) : null}
          {showErpLink ? (
            <Link
              href="/dashboard"
              className="gate-press flex min-h-[52px] items-center justify-center rounded-2xl border border-line text-[15px] font-semibold text-content-1"
            >
              Back to ERP
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="gate-press min-h-[52px] rounded-2xl text-[15px] font-semibold text-content-3"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
