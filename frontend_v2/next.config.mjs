/** @type {import('next').NextConfig} */
const nextConfig = {
    // Prevent Next from rewriting trailing slashes on API routes.
    // We handle `/api/*` slash compatibility at the Django layer.
    skipTrailingSlashRedirect: true,
    webpack: (config, { dev }) => {
        if (dev && process.env.DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE === '1') {
            config.cache = false;
        }
        return config;
    },
};

export default nextConfig;
