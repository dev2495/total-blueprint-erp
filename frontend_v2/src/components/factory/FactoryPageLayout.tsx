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
        <div className="min-h-screen bg-[#F6F8FB]">
            <div className="sticky top-0 z-10 bg-[#F6F8FB]/80 backdrop-blur-md border-b border-white/20 pb-4 pt-6 px-6">
                <PageHeader
                    title={title}
                    description={description}
                    actions={actions}
                    helpRoute={helpRoute}
                    helpSummary={helpSummary}
                    showHelpInline={Boolean(helpRoute || helpSummary)}
                    className="mb-4"
                />

                {onSearchChange && (
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="pl-9 bg-white border-slate-200 focus:border-blue-500 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200"
                        />
                    </div>
                )}
            </div>

            <div className="p-6">
                {children}
            </div>
        </div>
    )
}
