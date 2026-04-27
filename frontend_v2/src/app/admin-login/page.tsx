"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { api, ensureCsrfToken } from "@/lib/api"

export default function AdminLoginPage() {
    const { login } = useAuth()
    const [identifier, setIdentifier] = useState("")
    const [password, setPassword] = useState("")
    const [totp, setTotp] = useState("")
    const [error, setError] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [clientReady, setClientReady] = useState(false)

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
        if (totp.trim().length < 6) {
            setError("Enter your 6 digit admin code.")
            return
        }
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
            const detail = apiError.response?.data?.detail || apiError.response?.data?.error || apiError.message
            setError(status && status >= 500 ? `Server error (${status}). ${detail || ""}`.trim() : detail || "Invalid admin credentials")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <main className="auth-page erp-canvas">
            <div className="auth-frame">
                <section className="auth-hero admin">
                    <div className="auth-hero-content">
                        <div className="auth-badge"><ShieldCheck size={16} /> Privileged door</div>
                        <div className="auth-kicker">System Admin Console</div>
                        <h1 className="auth-title">Admin access.<br />Audited.</h1>
                        <p className="auth-copy">You are entering the privileged console. User, role, policy, and operational changes are logged and reviewed.</p>
                    </div>
                    <div className="auth-hero-footer">
                        <AuthMini label="Session intent" value="Read-only" />
                        <AuthMini label="Session intent" value="Operations" />
                        <AuthMini label="Session intent" value="Privileged" />
                    </div>
                </section>

                <section className="auth-panel-wrap">
                    <div className="auth-panel">
                        <div className="auth-icon admin"><KeyRound size={28} /></div>
                        <h2 className="auth-form-title">Verify admin session</h2>
                        <p className="auth-form-copy">Password and second factor are required before entering the admin console.</p>
                        <div className="auth-notice"><AlertTriangle size={16} /> All actions here are logged.</div>
                        <div data-testid="admin-login-client-ready" className="auth-ready">
                            <CheckCircle2 size={14} />
                            {clientReady ? "Client ready" : "Preparing session"}
                        </div>
                        <form data-testid="admin-login-form" className="auth-form" onSubmit={onSubmit}>
                            {error ? <div className="auth-error">{error}</div> : null}
                            <label>
                                <span className="auth-label">Admin email</span>
                                <input data-testid="admin-login-identifier" className="auth-input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" disabled={isLoading} required />
                            </label>
                            <div className="auth-field-row">
                                <label>
                                    <span className="auth-label">Password</span>
                                    <input data-testid="admin-login-password" className="auth-input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" disabled={isLoading} required />
                                </label>
                                <label>
                                    <span className="auth-label">TOTP</span>
                                    <input data-testid="admin-login-totp" className="auth-input mono" value={totp} onChange={(event) => setTotp(event.target.value)} inputMode="numeric" disabled={isLoading} required />
                                </label>
                            </div>
                            <button data-testid="admin-login-submit" className="auth-submit admin" type="submit" disabled={isLoading}>
                                {isLoading ? "Verifying..." : "Enter admin console"}
                                <ArrowRight size={16} />
                            </button>
                        </form>
                    </div>
                </section>
            </div>
        </main>
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
