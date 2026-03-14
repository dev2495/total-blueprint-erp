"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2, ShieldCheck, Workflow } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { api, ensureCsrfToken, RESOLVED_API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const formSchema = z.object({
    identifier: z.string().min(1, "Email or username is required"),
    password: z.string().min(1, "Password is required"),
});

function getErrorMessage(error: unknown) {
    const maybe = error as { response?: { status?: number; data?: { detail?: string; error?: string; message?: string } }; message?: string };
    const status = maybe?.response?.status;
    const detail = maybe?.response?.data?.detail || maybe?.response?.data?.error || maybe?.response?.data?.message || maybe?.message;
    if (!status && String(detail || "").toLowerCase().includes("network")) {
        return `Backend API unreachable at ${RESOLVED_API_BASE}. Ensure backend is running and reachable on the same network.`;
    }
    return status && status >= 500 ? `Server error (${status}). ${detail || ""}`.trim() : detail || "Invalid credentials";
}

export default function LoginPage() {
    const { login } = useAuth();
    const [error, setError] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [clientReady, setClientReady] = useState(false);

    useEffect(() => {
        setClientReady(true);
    }, []);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            identifier: "",
            password: "",
        },
    });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setIsLoading(true);
        setError("");
        try {
            await ensureCsrfToken();
            const { data } = await api.post("/api/users/login", {
                identifier: values.identifier.trim(),
                password: values.password,
            });
            const user = data?.user || (await api.get("/api/users/me")).data;
            login(user);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-slate-100">
            <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 lg:grid-cols-2">
                <div className="relative hidden overflow-hidden bg-slate-900 p-10 lg:flex lg:flex-col lg:justify-between">
                    <div className="absolute -left-16 -top-20 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
                    <div className="absolute -bottom-16 right-0 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
                    <div className="relative z-10 space-y-5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-100">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Production-Ready ERP
                        </div>
                        <h1 className="max-w-md text-4xl font-black leading-tight text-white">
                            Total Poly Print
                            <span className="block text-cyan-300">Operations Command</span>
                        </h1>
                        <p className="max-w-md text-sm text-slate-200">
                            Unified sales-to-dispatch execution, governance controls, and live plant visibility in one secure system.
                        </p>
                    </div>
                    <div className="relative z-10 grid gap-3">
                        {[
                            "Role-based access with governance controls",
                            "Real-time production and dispatch workflows",
                            "Audit-ready notification and approval trails",
                        ].map((line) => (
                            <div key={line} className="flex items-center gap-2 text-sm text-slate-200">
                                <Workflow className="h-4 w-4 text-cyan-300" />
                                <span>{line}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-center px-4 py-10 sm:px-8">
                    <Card className="w-full max-w-md border-slate-200 shadow-xl">
                        <CardHeader className="space-y-2">
                            <CardTitle className="text-2xl font-black tracking-tight text-slate-900">Sign In</CardTitle>
                            <CardDescription>Use your email or username to continue.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form method="POST" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" data-testid="login-form">
                                    {clientReady ? <span className="sr-only" data-testid="login-client-ready">ready</span> : null}
                                    {error ? (
                                        <Alert variant="destructive" data-testid="login-error">
                                            <AlertDescription>{error}</AlertDescription>
                                        </Alert>
                                    ) : null}

                                    <FormField
                                        control={form.control}
                                        name="identifier"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Email or Username</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        autoComplete="username"
                                                        placeholder="name@company.com or username"
                                                        data-testid="login-identifier"
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
                                                <FormLabel>Password</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                            type={showPassword ? "text" : "password"}
                                                            autoComplete="current-password"
                                                            placeholder="Enter your password"
                                                            data-testid="login-password"
                                                            {...field}
                                                            disabled={isLoading}
                                                        />
                                                        <button
                                                            type="button"
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100"
                                                            onClick={() => setShowPassword((prev) => !prev)}
                                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                                        >
                                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <Button type="submit" className="h-11 w-full bg-slate-900 hover:bg-slate-800" disabled={isLoading} data-testid="login-submit">
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Signing in...
                                            </>
                                        ) : (
                                            "Continue"
                                        )}
                                    </Button>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
