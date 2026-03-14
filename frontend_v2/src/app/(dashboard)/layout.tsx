import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import { HelpPageBanner } from "@/components/help/help-page-banner"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen w-full overflow-hidden bg-premium-mesh">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden relative z-10">
                <Header />
                <main className="flex-1 overflow-auto p-4 lg:p-8 w-full max-w-[1600px] mx-auto z-10 scrollbar-elegant">
                    <HelpPageBanner />
                    {children}
                </main>
            </div>
        </div>
    )
}
