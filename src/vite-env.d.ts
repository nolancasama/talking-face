/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_TTS_PROXY_URL?: string;
  /** Development only. Never set these in a production build. */
  readonly VITE_DEV_AZURE_KEY?: string;
  readonly VITE_DEV_AZURE_REGION?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
