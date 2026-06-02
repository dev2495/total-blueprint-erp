"use client"

import { useEffect, useState } from "react"
import { ArrowRight, CheckCircle2, Eye, EyeOff, Factory, KeyRound, ShieldCheck, Workflow } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { api, ensureCsrfToken } from "@/lib/api"

function readableLoginError(value: unknown): string {
    if (!value) return ""
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.map(readableLoginError).filter(Boolean).join(" ")
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        return (
            readableLoginError(obj.detail) ||
            readableLoginError(obj.error) ||
            readableLoginError(obj.non_field_errors) ||
            Object.values(obj).map(readableLoginError).filter(Boolean).join(" ")
        )
    }
    return String(value)
}

export default function LoginPage() {
    const { login } = useAuth()
    const [identifier, setIdentifier] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [clientReady, setClientReady] = useState(false)
    const [showPassword, setShowPassword] = useState(false)

    useEffect(() => {
        let mounted = true
        ensureCsrfToken().finally(() => {
            if (mounted) setClientReady(true)
        })
        return () => {
            mounted = false
        }
    }, [])

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setIsLoading(true)
        setError("")
        try {
            await ensureCsrfToken()
            const { data } = await api.post("/api/users/login", { identifier, password })
            const user = data?.user
            if (!user || typeof user !== "object") {
                throw new Error("Login succeeded but the user session could not be hydrated.")
            }
            await login(user)
        } catch (err: unknown) {
            const apiError = err as any
            const status = apiError.response?.status
            const detail = readableLoginError(apiError.response?.data) || readableLoginError(apiError.message)
            setError(status && status >= 500 ? `Server error (${status}). ${detail || ""}`.trim() : detail || "Invalid credentials")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <main className="auth-page erp-canvas">
            <div className="auth-frame">
                <section className="auth-hero">
                    <div className="auth-hero-content">
                        <div className="auth-badge"><ShieldCheck size={16} /> Total Poly Print ERP</div>
                        <div className="auth-kicker">Every roll, every order, one system.</div>
                        <h1 className="auth-title">Plan it.<br />Print it.<br />Prove it.</h1>
                        <p className="auth-copy">The control plane for a polymer print factory: sales, planning, production, inventory, admin, and audit visibility in one crisp operating stack.</p>
                        <div className="auth-stats">
                            <AuthStat icon={<Factory size={18} />} label="Active orders" value="128" copy="Live release queue" />
                            <AuthStat icon={<Workflow size={18} />} label="Roll output" value="4,210 kg" copy="Shift visible" />
                            <AuthStat icon={<CheckCircle2 size={18} />} label="Plant uptime" value="94%" copy="Audited today" />
                        </div>
                    </div>
                    <div className="auth-hero-footer">
                        <AuthMini label="Build" value="v2.4" />
                        <AuthMini label="Auth" value="Cookie + CSRF" />
                        <AuthMini label="Runtime" value="Prod-ready" />
                    </div>
                </section>

                <section className="auth-panel-wrap">
                    <div className="auth-panel">
                        <div className="auth-icon"><KeyRound size={28} /></div>
                        <h2 className="auth-form-title">Welcome back</h2>
                        <p className="auth-form-copy">Sign in to continue.</p>
                        <div data-testid="login-client-ready" className="auth-ready">
                            <CheckCircle2 size={14} />
                            {clientReady ? "Client ready" : "Preparing session"}
                        </div>
                        <form data-testid="login-form" data-client-ready={clientReady ? "true" : "false"} className="auth-form" onSubmit={onSubmit}>
                            {error ? <div className="auth-error">{error}</div> : null}
                            <label>
                                <span className="auth-label">Work email</span>
                                <input data-testid="login-identifier" className="auth-input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder="admin or admin@example.com" disabled={isLoading} required />
                            </label>
                            <label>
                                <span className="auth-label-line">
                                    <span className="auth-label">Password</span>
                                    <a className="auth-link" href="mailto:admin@totalpolyprint.local">Forgot?</a>
                                </span>
                                <span className="auth-password-field">
                                    <input data-testid="login-password" className="auth-input auth-password-input" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" disabled={isLoading} required />
                                    <button
                                        type="button"
                                        className="auth-password-toggle"
                                        onClick={() => setShowPassword((value) => !value)}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                        disabled={isLoading}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </span>
                            </label>
                            <button data-testid="login-submit" className="auth-submit" type="submit" disabled={isLoading}>
                                {isLoading ? "Signing in..." : "Sign in"}
                                <ArrowRight size={16} />
                            </button>
                        </form>
                        <div className="auth-policy">
                            <strong>Access stays policy-controlled.</strong>
                            Planner, audit, WCM, machine, and dispatch surfaces keep their role gates after session bootstrap.
                        </div>
                    </div>
                </section>
            </div>
        </main>
    )
}

function AuthStat({ icon, label, value, copy }: { icon: React.ReactNode; label: string; value: string; copy: string }) {
    return (
        <div className="auth-stat">
            <div>{icon}</div>
            <div className="auth-stat-label">{label}</div>
            <div className="auth-stat-value">{value}</div>
            <div className="auth-stat-copy">{copy}</div>
        </div>
    )
}

function AuthMini({ label, value }: { label: string; value: string }) {
    return (
        <div className="auth-mini">
            <div className="auth-mini-label">{label}</div>
            <div className="auth-mini-value">{value}</div>
        </div>
    )
}
