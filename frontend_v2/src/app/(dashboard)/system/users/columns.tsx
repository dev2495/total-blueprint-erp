"use client"

import { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, FileEdit, Trash, Shield, Eye, Key, ShieldCheck, UserCheck, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { User } from "@/services/system-users"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { getCanonicalRoleLabel } from "@/lib/roles"

interface ColumnsProps {
    onDelete: (user: User) => void;
}

export const getColumns = ({ onDelete }: ColumnsProps): ColumnDef<User>[] => [
    {
        accessorKey: "username",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Identifier</div>,
        cell: ({ row }) => (
            <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center border border-slate-100 group-hover:bg-white transition-colors">
                    <UserCheck className="h-4 w-4 text-slate-400 group-hover:text-indigo-600" />
                </div>
                <div className="flex flex-col">
                    <Link href={`/system/users/${row.original.id}`} className="font-black text-slate-900 hover:text-indigo-600 transition-colors uppercase text-[11px] tracking-tight">
                        {row.getValue("username")}
                    </Link>
                    {row.original.is_owner && (
                        <div className="flex items-center gap-1 mt-0.5">
                            <Shield className="h-2.5 w-2.5 text-amber-500" />
                            <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest italic">Owner</span>
                        </div>
                    )}
                </div>
            </div>
        )
    },
    {
        accessorKey: "full_name",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Profile</div>,
        cell: ({ row }) => (
            <div className="text-[11px] font-bold text-slate-500 uppercase italic">
                {row.original.full_name || "Unassigned"}
            </div>
        )
    },
    {
        accessorKey: "role_info.name",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Authority</div>,
        cell: ({ row }) => {
            const role = row.original.role_info;
            if (!role) return <span className="text-[10px] font-black text-slate-300 italic uppercase">No Protocol</span>;
            return (
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-indigo-50/50 text-indigo-600 border-indigo-100 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md italic">
                        {role.code}
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                        {getCanonicalRoleLabel(role.code, role.name)}
                    </span>
                </div>
            )
        }
    },
    {
        id: "permissions",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Access Delta</div>,
        cell: ({ row }) => {
            const rolePerms = row.original.role_info?.default_permissions?.length || 0;
            const extraPerms = row.original.extra_permissions?.length || 0;
            return (
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                        <Key className="h-3 w-3 text-slate-400" />
                        <span className="text-[10px] font-black text-slate-900">{rolePerms}</span>
                    </div>
                    {extraPerms > 0 && (
                        <Badge className="text-[8px] font-black bg-amber-50 text-amber-600 border-amber-100 px-1.5 h-4 uppercase tracking-[0.1em]">
                            +{extraPerms} OVERRIDE
                        </Badge>
                    )}
                </div>
            )
        }
    },
    {
        accessorKey: "is_active",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Pulse</div>,
        cell: ({ row }) => {
            const isActive = row.getValue("is_active")
            return (
                <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", isActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300")} />
                    <span className={cn("text-[10px] font-black uppercase tracking-widest", isActive ? "text-emerald-600" : "text-slate-400")}>
                        {isActive ? "Active" : "Revoked"}
                    </span>
                </div>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const user = row.original

            return (
                <div className="flex justify-end pr-4">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100 active-scale group">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-none shadow-2xl p-2 min-w-[160px] bg-white/95 backdrop-blur-md ring-1 ring-slate-100">
                            <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-3 pb-2 italic">Entity Protocols</DropdownMenuLabel>
                            <DropdownMenuItem asChild className="rounded-lg py-2.5 focus:bg-indigo-50 focus:text-indigo-600 transition-colors cursor-pointer">
                                <Link href={`/system/users/${user.id}`} className="flex items-center w-full">
                                    <Eye className="mr-3 h-3.5 w-3.5" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Access Profile</span>
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-50" />
                            <DropdownMenuItem onClick={() => onDelete(user)} className="rounded-lg py-2.5 text-rose-600 focus:bg-rose-50 focus:text-rose-700 transition-colors cursor-pointer">
                                <div className="flex items-center w-full">
                                    <Trash className="mr-3 h-3.5 w-3.5" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Revoke Access</span>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )
        },
    },
]
