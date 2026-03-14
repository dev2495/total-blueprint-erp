"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCcw } from "lucide-react"

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error("Page Error:", error)
    }, [error])

    return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-6 text-center">
            <div className="p-4 bg-red-50 rounded-full mb-4">
                <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong!</h2>
            <p className="text-slate-500 text-sm max-w-md mb-6">
                {error.message || "An unexpected error occurred while rendering the Template Studio."}
            </p>
            <div className="flex gap-3">
                <Button onClick={() => reset()} variant="outline" className="rounded-xl">
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Try again
                </Button>
                <Button onClick={() => window.location.reload()} className="bg-slate-900 rounded-xl">
                    Reload Page
                </Button>
            </div>
        </div>
    )
}
