"use client"

import { PageHeader } from "@/components/ui-custom/page-header"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import type { LocalizedText } from "@/help/types"

interface FactoryPageLayoutProps {
    title: string
    description?: string
    actions?: React.ReactNode
    children: React.ReactNode
    searchQuery?: string
    onSearchChange?: (query: string) => void
    searchPlaceholder?: string
    helpRoute?: string
    helpSummary?: LocalizedText | string
}

export function FactoryPageLayout({
    title,
    description,
    actions,
    children,
    searchQuery,
    onSearchChange,
    searchPlaceholder = "Search...",
    helpRoute,
    helpSummary,
}: FactoryPageLayoutProps) {
    return (
        <div className="min-w-0 bg-[radial-gradient(circle_at_top,#eef4ff,transparent_42%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_100%)]">
            <div className="px-0 pt-0">
                <div className="rounded-[2rem] border border-white/70 bg-white/72 px-4 py-4 shadow-[0_22px_60px_-46px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:px-5 sm:py-5 lg:px-6">
                    <PageHeader
                        title={title}
                        description={description}
                        actions={actions}
                        helpRoute={helpRoute}
                        helpSummary={helpSummary}
                        showHelpInline={Boolean(helpRoute || helpSummary)}
                        className="mb-0 pb-0"
                    />

                    {onSearchChange && (
                        <div className="relative mt-4 max-w-xl">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-4" />
                            <Input
                                placeholder={searchPlaceholder}
                                value={searchQuery}
                                onChange={(e) => onSearchChange(e.target.value)}
                                className="h-12 rounded-2xl border-slate-200 bg-white/90 pl-10 shadow-sm transition-all duration-200 hover:shadow-md focus:border-blue-500"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="min-w-0 px-0 pb-2 pt-4 sm:pt-5">
                {children}
            </div>
        </div>
    )
}
