// Credential policy, enforced rather than documented.
//
// A production PWA is a static bundle served to the public; anything it can
// read, any visitor can read. So the built app has exactly one way to reach a
// paid TTS service: our own thin endpoint, which holds the subscription key
// server-side and never returns it. The direct-from-browser path exists only to
// make local development bearable and is compiled out of production builds --
// `import.meta.env.DEV` is statically replaced, so the branch below is dead
// code that a production bundle physically cannot execute.

export interface TTSEndpointConfig {
  /** Our own proxy. The only production-legal path to a credentialed service. */
  proxyUrl: string;
}

export interface DevDirectConfig {
  region: string;
  subscriptionKey: string;
}

const PROXY_URL = import.meta.env.VITE_TTS_PROXY_URL ?? '/api/tts';

export function endpointConfig(): TTSEndpointConfig {
  return { proxyUrl: PROXY_URL };
}

/**
 * Development-only direct credentials, read from a gitignored .env.local.
 * Returns null in any production build, unconditionally.
 */
export function devDirectConfig(): DevDirectConfig | null {
  if (!import.meta.env.DEV) return null;
  const key = import.meta.env.VITE_DEV_AZURE_KEY;
  const region = import.meta.env.VITE_DEV_AZURE_REGION;
  if (!key || !region) return null;
  console.warn('[tts] using direct Azure credentials — development builds only');
  return { region, subscriptionKey: key };
}
