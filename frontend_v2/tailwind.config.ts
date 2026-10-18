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
        // `<alpha-value>` lets opacity modifiers work on the HSL tokens
        // (bg-primary/10, hover:bg-destructive/90, ring-primary/40). Before
        // this, such classes were silently dropped by Tailwind.
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        // Soft 40% accent ring for keyboard focus: focus-visible:ring-focus.
        focus: "hsl(var(--ring) / 0.4)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        // Tier-2 semantic utilities (P0.3) — resolve to CSS vars in globals.css.
        // Reachability fix: feature code can now write bg-surface-1, text-content-2,
        // bg-success-bg, border-danger-border, text-info-fg, etc. instead of raw palette.
        surface: {
          0: "var(--surface-0)",
          1: "rgb(var(--surface-1-rgb) / <alpha-value>)",
          2: "rgb(var(--surface-2-rgb) / <alpha-value>)",
          3: "rgb(var(--surface-3-rgb) / <alpha-value>)",
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
          DEFAULT: "rgb(var(--success-fg-rgb) / <alpha-value>)",
          fg: "rgb(var(--success-fg-rgb) / <alpha-value>)",
          bg: "var(--success-bg)",
          border: "var(--success-border)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning-fg-rgb) / <alpha-value>)",
          fg: "rgb(var(--warning-fg-rgb) / <alpha-value>)",
          bg: "var(--warning-bg)",
          border: "var(--warning-border)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger-fg-rgb) / <alpha-value>)",
          fg: "rgb(var(--danger-fg-rgb) / <alpha-value>)",
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
          DEFAULT: "rgb(var(--order-fg-rgb) / <alpha-value>)",
          fg: "rgb(var(--order-fg-rgb) / <alpha-value>)",
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
      // Opacity steps used by token colours (bg-surface-1/88 etc.) that are not in
      // Tailwind's default scale; without them the class is silently dropped.
      opacity: {
        12: "0.12",
        14: "0.14",
        58: "0.58",
        72: "0.72",
        76: "0.76",
        78: "0.78",
        88: "0.88",
        92: "0.92",
        94: "0.94",
        96: "0.96",
      },
      // Readable floor-screen minimums: captions never go below 12px.
      fontSize: {
        caption: ["12px", { lineHeight: "1.35" }],
        label: ["13px", { lineHeight: "1.4" }],
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
