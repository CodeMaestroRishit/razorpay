/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the deployed backend, including the /api prefix — e.g.
   * https://your-backend.up.railway.app/api. Leave unset in dev, where
   * Vite's proxy handles "/api" (see vite.config.ts).
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
