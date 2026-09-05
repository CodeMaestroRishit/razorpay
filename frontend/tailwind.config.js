/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ink: the dark hero/CTA-panel base — a deep blue-black rather
        // than neutral black, so it reads as part of the same blue family
        // as `brand` instead of a competing near-black. Razorpay's own
        // site does exactly this for its AI section (a black "Vulcan"
        // banner with blue circuitry) — dark surface, blue accent.
        ink: {
          DEFAULT: "#0B0F2E",
          900: "#070A1F",
          800: "#141A45",
        },
        // brand: Razorpay's own blue — now the PRIMARY accent (headline
        // emphasis, CTAs, links, the "treated" data series), not a quiet
        // secondary nod.
        brand: {
          DEFAULT: "#3D5AFE",
          dark: "#2541C7",
          50: "#EEF1FF",
        },
        // accent: a warm coral, blue's complement — reserved for the
        // handful of moments that should visually interrupt the blue
        // (the guardrail — literally the one thing that can say no — and
        // the incremental-recovery number). Close kin to the dataviz
        // reference palette's validated "holdout" orange, so the same
        // warm tone means roughly the same thing in the chart and in the
        // chrome around it.
        accent: {
          DEFAULT: "#FF6B4A",
          light: "#FF9B7A",
          dark: "#C13F1F",
          50: "#FFF1EC",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["\"Space Grotesk\"", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,37,64,0.04), 0 4px 16px rgba(10,37,64,0.06)",
      },
      backgroundImage: {
        "dot-grid": "radial-gradient(circle, rgba(255,255,255,0.14) 1px, transparent 1px)",
      },
      backgroundSize: {
        "dot-grid": "16px 16px",
      },
    },
  },
  plugins: [],
};
