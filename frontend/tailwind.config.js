/** @type {import('tailwindcss').Config} */
// Identity tokens: ~/workspace/your_files/design-standard.md §9 (source of truth).
// RAINCHECK: bg ink navy #0B1220 · accent rain cyan #35E0FF · paper #F4EFE6 · text-on-dark #F4FEFF.
// The pre-standard palette is retired — see design-standard.md §9. Do not
// reintroduce the old hex values anywhere in src/ (the design-compliance
// test fails the build if they appear).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        rain: "#35E0FF",
        paper: "#F4EFE6",
        ice: "#F4FEFF",
      },
      fontFamily: {
        // Display: heavy grotesque, ALL-CAPS headlines (standard §1). Body: Inter. No serif anywhere.
        display: ['"Archivo Black"', "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
