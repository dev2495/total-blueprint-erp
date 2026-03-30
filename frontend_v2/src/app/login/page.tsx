"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useAuth } from "@/components/auth-provider"
import { api, ensureCsrfToken } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, Loader2, ShieldCheck, Sparkles, Workflow, Factory, ArrowRight } from "lucide-react"

const formSchema = z.object({
    identifier: z.string().min(1, "Username or email is required"),
    password: z.string().min(1, "Password is required"),
})

export default function LoginPage() {
    const { login } = useAuth()
    const [error, setError] = useState<string>("")
    const [isLoading, setIsLoading] = useState(false)
    const [clientReady, setClientReady] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            identifier: "",
            password: "",
        },
    })

    useEffect(() => {
        let mounted = true

        const bootstrap = async () => {
            try {
                await ensureCsrfToken()
            } finally {
                if (mounted) {
                    setClientReady(true)
                }
            }
        }

        bootstrap()
        return () => {
            mounted = false
        }
    }, [])

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setIsLoading(true)
        setError("")
        try {
            await ensureCsrfToken()
            const { data } = await api.post("/api/users/login", values)
            const user = data?.user
            if (!user || typeof user !== "object") {
                throw new Error("Login succeeded but the user session could not be hydrated.")
            }
            login(user)
        } catch (err: unknown) {
            const error = err as any
            const status = error.response?.status
            const detail =
                error.response?.data?.detail ||
                error.response?.data?.error ||
                error.message
            setError(status && status >= 500 ? `Server error (${status}). ${detail || ""}`.trim() : (detail || "Invalid credentials"))
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.22),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(196,181,253,0.22),_transparent_26%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_48%,#f8fafc_100%)] px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center justify-center">
                <div className="grid w-full gap-6 lg:grid-cols-[1.15fr_minmax(390px,460px)]">
                    <section className="relative overflow-hidden rounded-[2.2rem] border border-white/60 bg-[linear-gradient(135deg,#0f172a_0%,#172554_42%,#1d4ed8_100%)] px-6 py-7 text-white shadow-[0_35px_100px_-48px_rgba(15,23,42,0.55)] sm:px-8 sm:py-9 lg:min-h-[720px] lg:px-10 lg:py-10">
                        <div className="pointer-events-none absolute -left-16 top-16 h-52 w-52 rounded-full bg-cyan-300/15 blur-3xl" />
                        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-indigo-200/10 blur-3xl" />
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

                        <div className="relative z-10 flex h-full flex-col justify-between gap-10">
                            <div className="space-y-8">
                                <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100">
                                    <ShieldCheck className="h-4 w-4" />
                                    Controlled ERP Access
                                </div>

                                <div className="max-w-2xl space-y-5">
                                    <div>
                                        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">Total Poly Print</p>
                                        <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-[3.45rem]">
                                            Production, planning, sales, and dispatch on one calm operating surface.
                                        </h1>
                                    </div>
                                    <p className="max-w-xl text-base leading-7 text-slate-200 sm:text-lg sm:leading-8">
                                        Sign in to the live ERP workspace. Role routing, planner controls, approvals, and audit visibility apply immediately after session bootstrap.
                                    </p>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-3">
                                    <PosterStat
                                        icon={<Factory className="h-4 w-4" />}
                                        label="One shell"
                                        text="Sales, planning, WCM, dispatch, and inventory stay in one controlled runtime."
                                    />
                                    <PosterStat
                                        icon={<Workflow className="h-4 w-4" />}
                                        label="Role aware"
                                        text="Landing, actions, and access gates are applied from your assigned role after sign-in."
                                    />
                                    <PosterStat
                                        icon={<Sparkles className="h-4 w-4" />}
                                        label="Render ready"
                                        text="Cookie-auth, same-origin API traffic, and release validation stay aligned with deployment."
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 rounded-[1.8rem] border border-white/10 bg-white/8 p-4 backdrop-blur sm:grid-cols-3">
                                {[
                                    { title: "Session bootstrap", value: "Cookie + CSRF" },
                                    { title: "Post-login routing", value: "Role landing" },
                                    { title: "Runtime mode", value: "Prod-ready shell" },
                                ].map((item) => (
                                    <div key={item.title} className="rounded-[1.3rem] border border-white/10 bg-white/8 px-4 py-4">
                                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/75">{item.title}</div>
                                        <div className="mt-2 text-sm font-bold text-white">{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="relative mx-auto flex w-full max-w-[470px] items-center">
                        <div className="absolute inset-x-6 top-12 h-40 rounded-full bg-indigo-200/45 blur-3xl" />
                        <div className="relative w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 p-5 shadow-[0_35px_80px_-42px_rgba(99,102,241,0.35)] backdrop-blur sm:p-6 lg:p-7">
                            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/70 to-transparent" />
                            <div className="space-y-6">
                                <div className="space-y-4 text-center">
                                    <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-indigo-50 text-indigo-700 shadow-sm">
                                        <ShieldCheck className="h-7 w-7" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Secure workspace access</div>
                                        <h2 className="text-[2rem] font-black tracking-tight text-slate-950">Sign in</h2>
                                        <p className="text-sm leading-6 text-slate-500">
                                            Enter your username or email to access the ERP workspace and continue from your assigned landing surface.
                                        </p>
                                    </div>
                                    <div
                                        data-testid="login-client-ready"
                                        className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700"
                                    >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        {clientReady ? "Client ready" : "Preparing session"}
                                    </div>
                                </div>

                                <Form {...form}>
                                    <form
                                        data-testid="login-form"
                                        data-client-ready={clientReady ? "true" : "false"}
                                        onSubmit={form.handleSubmit(onSubmit)}
                                        className="space-y-5"
                                    >
                                        {error && (
                                            <Alert variant="destructive">
                                                <AlertDescription>{error}</AlertDescription>
                                            </Alert>
                                        )}

                                        <div className="grid gap-5">
                                            <FormField
                                                control={form.control}
                                                name="identifier"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Username or email</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                data-testid="login-identifier"
                                                                placeholder="admin or admin@example.com"
                                                                autoComplete="username"
                                                                className="h-12 rounded-2xl border-slate-200 bg-slate-50/70"
                                                                {...field}
                                                                disabled={isLoading}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="password"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Password</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                data-testid="login-password"
                                                                type="password"
                                                                placeholder="••••••••"
                                                                autoComplete="current-password"
                                                                className="h-12 rounded-2xl border-slate-200 bg-slate-50/70"
                                                                {...field}
                                                                disabled={isLoading}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <Button
                                            data-testid="login-submit"
                                            type="submit"
                                            className="h-12 w-full rounded-2xl bg-[linear-gradient(135deg,#4f46e5,#4338ca)] text-base font-bold shadow-[0_16px_36px_-24px_rgba(79,70,229,0.85)]"
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Signing in...
                                                </>
                                            ) : (
                                                <>
                                                    Enter workspace
                                                    <ArrowRight className="ml-2 h-4 w-4" />
                                                </>
                                            )}
                                        </Button>
                                    </form>
                                </Form>

                                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/75 px-4 py-4 text-sm text-slate-600">
                                    <div className="font-semibold text-slate-900">Access stays policy-controlled after sign-in.</div>
                                    <p className="mt-1 leading-6">
                                        Planner, audit, WCM, machine, and dispatch surfaces keep their role gates after session bootstrap. This redesign does not change the auth logic underneath.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}

function PosterStat({
    icon,
    label,
    text,
}: {
    icon: React.ReactNode
    label: string
    text: string
}) {
    return (
        <div className="rounded-[1.55rem] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-cyan-100">
                {icon}
            </div>
            <div className="mt-4 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/75">{label}</div>
            <p className="mt-2 text-sm leading-6 text-slate-200">{text}</p>
        </div>
    )
}
