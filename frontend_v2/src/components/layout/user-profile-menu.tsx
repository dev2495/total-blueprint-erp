"use client";

import Link from "next/link";
import {
  History,
  KeyRound,
  LogOut,
  Monitor,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";

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

export function UserProfileMenu({
  triggerTestId = "profile-menu-trigger",
}: {
  triggerTestId?: string;
}) {
  const { user, effectiveRole, logout } = useAuth();
  if (!user) return null;

  const roleCode = String(
    effectiveRole || user.role_info?.code || "",
  ).toUpperCase();
  const canAccessGovernance = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(
    roleCode,
  );
  const canAccessAudit = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);
  const canSwitchTerminal = roleCode === "WORK_CENTER_MANAGER";
  const displayName = user.full_name || user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-1 px-2 py-1.5 shadow-sm transition hover:bg-surface-2"
          type="button"
          aria-label="Open profile menu"
          data-testid={triggerTestId}
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatar_url || ""} alt={displayName} />
            <AvatarFallback className="text-[11px] font-bold">
              {initialsFromName(
                displayName,
                user.username.slice(0, 2).toUpperCase(),
              )}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-xs font-semibold text-content-2 md:inline">
            {displayName}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1">
          <div className="text-sm font-semibold text-content-1">
            {displayName}
          </div>
          <div className="text-xs font-normal text-content-3">
            {user.email || "Email missing"}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-content-3">
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
            <Link href="/production/machine-selector">
              <Monitor className="h-4 w-4" />
              Switch Machine
            </Link>
          </DropdownMenuItem>
        ) : null}

        {canAccessAudit ? (
          <DropdownMenuItem asChild>
            <Link href="/system/audit">
              <History className="h-4 w-4" />
              Audit Center
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
          className="text-danger-fg focus:text-danger-fg"
          data-testid="profile-menu-logout"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
