/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#ec4899", // Pink primary color as requested
        "primary-hover": "#db2777",
        "primary-soft": "#ffe4e6",
        brand: {
          DEFAULT: "#be185d",
          hover: "#9d174d",
          soft: "#fdf2f8",
          border: "#fbcfe8",
          ink: "#111827",
        },
        "background-light": "#f8fafc", // Slate-50
        "background-dark": "#18181b", // Zinc-950
        "surface-light": "#ffffff",
        "surface-dark": "#27272a", // Zinc-800
        "border-light": "#e2e8f0",
        "border-dark": "#3f3f46",
        secondary: "#6366f1", // Indigo
        "accent-blue": "#6366f1",
        "text-light": "#1f2937",
        "text-dark": "#e4e4e7",
      },
      fontFamily: {
        display: ["Outfit", "Inter", "sans-serif"],
        body: ["Outfit", "Inter", "sans-serif"],
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.75rem", // 12px
        "xl": "1rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
}
