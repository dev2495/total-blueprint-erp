"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { systemUserService, User, Role } from "@/services/system-users"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus, Users, Shield, ShieldCheck, Activity, Key, UserCheck, Zap } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export default function UsersPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()

    // Data Fetching
    const { data: users, isLoading: usersLoading } = useQuery({ queryKey: ["users"], queryFn: systemUserService.getUsers })
    const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: systemUserService.getRoles })

    const deleteMutation = useMutation({
        mutationFn: systemUserService.deleteUser,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] })
            toast({ title: "Success", description: "User credentials revoked." })
        }
    })

    // Stats
    const activeUsers = users?.filter(u => u.is_active).length || 0
    const totalRoles = roles?.length || 0

    return (
        <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-amber-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <ShieldCheck className="h-3 w-3" /> System Governance
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Identity
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-blue-600 italic">Control</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-xs flex items-center gap-2 italic">
                        Managing {users?.length || 0} authenticated entities across {totalRoles} authority roles <Activity className="h-3.5 w-3.5 text-blue-400" />
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/system/role-matrix" className="active-scale">
                        <Button variant="outline" className="h-11 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest">
                            Authority Matrix
                        </Button>
                    </Link>
                    <Link href="/system/users/new" className="active-scale">
                        <Button className="h-11 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-slate-200 transition-all">
                            <Plus className="h-4 w-4 mr-2" /> Provision New User
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Stats Cards - Recalibrated Scale */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: "Authenticated", value: users?.length || 0, icon: Users, color: "text-blue-600", bg: "bg-blue-50", desc: "Total system identities" },
                    { label: "Active Pulse", value: activeUsers, icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-50", desc: "Entities with live access" },
                    { label: "Authority Matrix", value: totalRoles, icon: Shield, color: "text-amber-600", bg: "bg-amber-50", desc: "Defined permission tiers" },
                    { label: "Recent Activity", value: "Sync OK", icon: Zap, color: "text-rose-600", bg: "bg-rose-50", desc: "Access logs normalized" }
                ].map((stat, i) => (
                    <Card key={i} className="border-none shadow-premium rounded-2xl bg-white/70 backdrop-blur-md overflow-hidden group hover:-translate-y-1 transition-all duration-300">
                        <CardHeader className="p-5 pb-2 flex flex-row items-center justify-between">
                            <div className={cn("p-2 rounded-xl transition-colors", stat.bg, stat.color)}>
                                <stat.icon className="h-4 w-4" />
                            </div>
                            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest italic">{stat.label}</span>
                        </CardHeader>
                        <CardContent className="p-5 pt-1">
                            <div className="text-2xl font-black text-slate-900 tracking-tighter">{stat.value}</div>
                            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase italic opacity-70">{stat.desc}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Main Table - Tactical Modernization */}
            <Card className="border-none shadow-premium rounded-[2rem] bg-white overflow-hidden">
                <CardHeader className="p-6 pb-2 border-b border-slate-50 bg-slate-50/30">
                    <CardTitle className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2 italic uppercase">
                        <Key className="h-4 w-4 text-blue-500" />
                        Identity Registry
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        columns={getColumns({
                            onDelete: (user) => {
                                if (confirm(`Revoke credentials for ${user.username}? This cannot be undone.`)) {
                                    deleteMutation.mutate(user.id)
                                }
                            }
                        })}
                        data={users || []}
                        filterColumn="username"
                        filterPlaceholder="Identify user..."
                    />
                </CardContent>
            </Card>

            {/* Role Snippets */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-2 border-none shadow-premium rounded-[1.5rem] bg-slate-900 text-white overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Shield className="h-24 w-24" />
                    </div>
                    <CardHeader className="p-6 pb-2">
                        <CardTitle className="text-sm font-black uppercase tracking-widest italic flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-blue-400" />
                            Policy Snapshot
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <div className="flex flex-wrap gap-2 mt-4">
                            {roles?.map((r: Role) => (
                                <Badge key={r.id} className="bg-white/5 hover:bg-white/10 text-white/70 border-white/5 py-1.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest italic transition-colors">
                                    {r.code}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-premium rounded-[1.5rem] bg-blue-600 text-white overflow-hidden relative flex flex-col justify-center items-center p-6 text-center group">
                    <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <ShieldCheck className="h-6 w-6 text-white" />
                    </div>
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] italic">Governance Active</h4>
                    <p className="text-[11px] font-bold text-blue-100 mt-2 leading-relaxed opacity-70 uppercase">RBAC Synchronized with <br /> Central Authority</p>
                </Card>
            </div>
        </div>
    )
}
