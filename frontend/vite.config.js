import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// RAINCHECK dashboard — React + Vite (founder redirect 2026-10-14; was Next.js).
// Env contract: import.meta.env.VITE_API_URL -> Receipt API base URL (required at
// runtime for every data screen; no fallback, no mock data).
//
// Note: the `test` key is read by Vitest at runtime. It is assigned via a
// variable (not a fresh literal) so tsc's excess-property check does not fire;
// Vitest 2.x ships no `vite` module augmentation for the key.
var config = {
    plugins: [react()],
    server: { port: 5173 },
    build: { target: "es2020" },
    test: {
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        environment: "node",
        // Tests run with plain `npm test`. Env in tests: import.meta.env with
        // VITE_ prefix (vi.stubEnv("VITE_API_URL", ...) to set per-test).
    },
};
export default defineConfig(config);
