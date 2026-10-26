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
        // Legacy utility names remain compatible while all brand accents use Paimon blue.
        pink: {
          50: "#f0f7fc", 100: "#e2eff9", 200: "#c5e0f0", 300: "#9bcbe5",
          400: "#67b0d6", 500: "#3277af", 600: "#28679e", 700: "#245780",
          800: "#224867", 900: "#202641", 950: "#14192f",
        },
        celestial: { navy: "#202641", ivory: "#f7f4ee", blue: "#3a7ebc", gold: "#dcb07c", steel: "#7483a0" },
        primary: "#28679e",
        "primary-hover": "#205580",
        "primary-soft": "#eaf3fa",
        brand: {
          DEFAULT: "#28679e",
          hover: "#205580",
          soft: "#eaf3fa",
          border: "#cdd9e4",
          ink: "#202641",
        },
        "background-light": "#f7f4ee",
        "background-dark": "#151b30",
        "surface-light": "#ffffff",
        "surface-dark": "#202641", // Zinc-800
        "border-light": "#e2e8f0",
        "border-dark": "#3f3f46",
        secondary: "#202641", // Indigo
        "accent-blue": "#3a7ebc",
        "text-light": "#202641",
        "text-dark": "#e4e4e7",
      },
      fontFamily: {
        display: ["Outfit", "Noto Sans Thai", "Inter", "system-ui", "sans-serif"],
        body: ["Outfit", "Noto Sans Thai", "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "Noto Sans Thai", "system-ui", "sans-serif"],
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
