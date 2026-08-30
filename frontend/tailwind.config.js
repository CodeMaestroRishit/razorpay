/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Razorpay-inspired: brand blue for accents/CTAs, deep navy for
        // dark sections, white/near-white for the base surface.
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
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,37,64,0.04), 0 4px 16px rgba(10,37,64,0.06)",
      },
    },
  },
  plugins: [],
};
