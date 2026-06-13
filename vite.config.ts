import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `/api` is served by the Vercel functions in ../api. For full-stack local dev
// run `vercel dev` (it serves the SPA and the functions on one port). Plain
// `npm run dev` runs the frontend only.
export default defineConfig({
  plugins: [react()],
});
