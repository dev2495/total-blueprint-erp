import path from "node:path";
import { fileURLToPath } from "node:url";

const apiPort = String(process.env.NEXT_PUBLIC_API_PORT || process.env.UI_E2E_API_PORT || "8000").trim() || "8000";
const configuredApiBase = String(process.env.UI_API_BASE_URL || process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
const localProxyTarget = /^https?:\/\//i.test(configuredApiBase)
    ? configuredApiBase.replace(/\/+$/, "")
    : `http://127.0.0.1:${apiPort}`;

const configDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    outputFileTracingRoot: path.resolve(configDir, ".."),
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    // Prevent Next from rewriting trailing slashes on API routes.
    // We handle `/api/*` slash compatibility at the Django layer.
    skipTrailingSlashRedirect: true,
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: `${localProxyTarget}/api/:path*`,
            },
        ];
    },
    webpack: (config, { dev }) => {
        if (dev && process.env.DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE === '1') {
            config.cache = false;
        }
        return config;
    },
};

export default nextConfig;
