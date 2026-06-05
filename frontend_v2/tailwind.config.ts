import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Tier-2 semantic utilities (P0.3) — resolve to CSS vars in globals.css.
        // Reachability fix: feature code can now write bg-surface-1, text-content-2,
        // bg-success-bg, border-danger-border, text-info-fg, etc. instead of raw palette.
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          glass: "var(--surface-glass)",
        },
        content: {
          1: "var(--content-1)",
          2: "var(--content-2)",
          3: "var(--content-3)",
          4: "var(--content-4)",
        },
        line: {
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        success: {
          DEFAULT: "var(--success-fg)",
          fg: "var(--success-fg)",
          bg: "var(--success-bg)",
          border: "var(--success-border)",
        },
        warning: {
          DEFAULT: "var(--warning-fg)",
          fg: "var(--warning-fg)",
          bg: "var(--warning-bg)",
          border: "var(--warning-border)",
        },
        danger: {
          DEFAULT: "var(--danger-fg)",
          fg: "var(--danger-fg)",
          bg: "var(--danger-bg)",
          border: "var(--danger-border)",
          solid: "var(--danger-solid)",
        },
        info: {
          DEFAULT: "var(--info-fg)",
          fg: "var(--info-fg)",
          bg: "var(--info-bg)",
          border: "var(--info-border)",
        },
        order: {
          DEFAULT: "var(--accent-order-fg)",
          fg: "var(--accent-order-fg)",
          bg: "var(--accent-order-bg)",
          border: "var(--accent-order-border)",
        },
        critical: "var(--accent-critical)",
        warm: "var(--accent-warm)",
        brand: {
          red: { DEFAULT: '#C9303B', 500: '#C9303B', 600: '#B12530' },
          orange: { DEFAULT: '#F58634', 500: '#F58634' },
          navy: { DEFAULT: '#29345D', 500: '#29345D', 600: '#1E2848' },
          blue: { DEFAULT: '#1068A9', 500: '#1068A9', 600: '#0A5388' },
          ink: '#4B4B4D',
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        r2: "var(--r-2)",
        r3: "var(--r-3)",
        r4: "var(--r-4)",
        r5: "var(--r-5)",
        r6: "var(--r-6)",
        pill: "var(--r-pill)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
