/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ink: the premium near-black base for hero/CTA panels and the
        // app shell. gold: the one accent color — used deliberately
        // sparingly (headline emphasis, primary CTAs, key numbers) so it
        // still reads as an accent, not wallpaper.
        ink: {
          DEFAULT: "#111113",
          900: "#0B0B0D",
          800: "#1A1A1D",
        },
        gold: {
          DEFAULT: "#C9A24B",
          light: "#E8C878",
          dark: "#A9832E",
          50: "#FBF6EA",
        },
        // Razorpay blue survives as a secondary accent — used for links,
        // interactive states, and the "treated" data series — a quiet nod
        // to the platform this was built for without literal branding.
        brand: {
          DEFAULT: "#3395FF",
          dark: "#1A73E8",
          50: "#EAF3FF",
        },
        navy: {
          DEFAULT: "#0A2540",
          950: "#071B30",
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
