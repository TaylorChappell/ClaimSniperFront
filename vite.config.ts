import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built asset URLs resolve correctly when the app is
  // served from a subpath (e.g. https://<user>.github.io/ClaimSniperFront/).
  // Works regardless of the repo name. For local `npm run dev` this is ignored.
  base: './',
  server: { port: 5173 },
});