"use client"

import { usePathname } from "next/navigation"
import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import { HelpPageBanner } from "@/components/help/help-page-banner"
import { useAuth } from "@/components/auth-provider"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, loading } = useAuth()
    const pathname = usePathname() || "/"
    const isMachineKioskRoute = /^\/production\/machine\/[^/]+\/?$/.test(pathname)

    if (loading || !user) {
        return (
            <div className="min-h-screen w-full overflow-x-hidden bg-premium-mesh">
                <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1720px] flex-col px-3 pb-6 pt-4 sm:px-4 sm:pb-8 lg:px-6 lg:pb-10 xl:px-8">
                    <div className="h-20 rounded-[1.75rem] border border-white/80 bg-white/75 shadow-premium backdrop-blur-xl" />
                    <div className="mt-5 grid flex-1 gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
                        <div className="hidden rounded-[1.75rem] border border-white/70 bg-white/70 shadow-sm backdrop-blur-xl lg:block" />
                        <div className="space-y-5">
                            <div className="h-14 rounded-[1.5rem] border border-white/70 bg-white/70 shadow-sm backdrop-blur-xl" />
                            <div className="h-44 rounded-[2rem] border border-white/70 bg-white/70 shadow-sm backdrop-blur-xl" />
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div
                                        key={`dashboard-shell-skeleton-${index}`}
                                        className="h-36 rounded-[1.7rem] border border-white/70 bg-white/70 shadow-sm backdrop-blur-xl"
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (isMachineKioskRoute) {
        return (
            <div className="min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#f3f5f7_0%,#e5eaef_100%)]">
                <main className="min-h-screen w-full">
                    {children}
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen w-full overflow-x-hidden bg-premium-mesh">
            <Sidebar />
            <div className="relative z-10 flex min-w-0 flex-col lg:ml-[270px]">
                <Header />
                <main className="z-10 mx-auto flex w-full max-w-[1720px] min-w-0 flex-col overflow-x-hidden px-3 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4 lg:px-6 lg:pb-10 lg:pt-5 xl:px-8">
                    <HelpPageBanner />
                    <div className="w-full min-w-0">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}
