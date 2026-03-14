"use client";

import Link from "next/link";
import { ShieldCheck, KeyRound, LogOut, Monitor, UserCircle2 } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getCanonicalRoleLabel } from "@/lib/roles";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initialsFromName(name: string, fallback = "U") {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return fallback;
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function UserProfileMenu() {
    const { user, effectiveRole, logout } = useAuth();
    if (!user) return null;

    const roleCode = String(effectiveRole || user.role_info?.code || "").toUpperCase();
    const canAccessGovernance = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);
    const canSwitchTerminal = ["OPERATOR", "WORK_CENTER_MANAGER"].includes(roleCode);
    const terminalHref = roleCode === "OPERATOR" ? "/production/machine-selector" : "/production/work-center";
    const terminalLabel = roleCode === "OPERATOR" ? "Switch Machine" : "Switch Work Center";
    const displayName = user.full_name || user.username;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-1.5 shadow-sm transition hover:bg-slate-50"
                    type="button"
                    aria-label="Open profile menu"
                    data-testid="profile-menu-trigger"
                >
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={user.avatar_url || ""} alt={displayName} />
                        <AvatarFallback className="text-[11px] font-bold">
                            {initialsFromName(displayName, user.username.slice(0, 2).toUpperCase())}
                        </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-xs font-semibold text-slate-700 md:inline">
                        {displayName}
                    </span>
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">{displayName}</div>
                    <div className="text-xs font-normal text-slate-500">{user.email || "Email missing"}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Role: {getCanonicalRoleLabel(roleCode, user.role_info?.name)}
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                    <Link href="/profile">
                        <UserCircle2 className="h-4 w-4" />
                        My Profile
                    </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                    <Link href="/profile?tab=security">
                        <KeyRound className="h-4 w-4" />
                        Change Password
                    </Link>
                </DropdownMenuItem>

                {canSwitchTerminal ? (
                    <DropdownMenuItem asChild>
                        <Link href={terminalHref}>
                            <Monitor className="h-4 w-4" />
                            {terminalLabel}
                        </Link>
                    </DropdownMenuItem>
                ) : null}

                {canAccessGovernance ? (
                    <DropdownMenuItem asChild>
                        <Link href="/system/governance">
                            <ShieldCheck className="h-4 w-4" />
                            Governance Console
                        </Link>
                    </DropdownMenuItem>
                ) : null}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => {
                        void logout();
                    }}
                    className="text-rose-600 focus:text-rose-700"
                    data-testid="profile-menu-logout"
                >
                    <LogOut className="h-4 w-4" />
                    Logout
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
