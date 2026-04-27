"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { getLandingPage } from "@/lib/roles"

/**
 * Root Redirect Component
 * Ensures the root URL "/" always redirects to the appropriate role-based dashboard.
 */
export default function RootRedirect() {
    const router = useRouter()
    const { user, effectiveRole, loading } = useAuth()

    useEffect(() => {
        if (loading) return
        if (user) {
            const userRoleCode = effectiveRole || user.entitlements?.role || user.role_info?.code || "GUEST"
            const landingPage = getLandingPage(userRoleCode)
            router.replace(landingPage)
        } else {
            router.replace("/login")
        }
    }, [user, effectiveRole, loading, router])

    return (
        <div className="flex h-screen w-full items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="text-sm font-medium text-slate-500">Redirecting to your dashboard...</p>
            </div>
        </div>
    )
}
