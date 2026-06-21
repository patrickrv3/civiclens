/**
 * Returns the correct API base URL depending on the runtime environment.
 *
 * - In a Capacitor native app (iOS/Android), relative URLs don't resolve
 *   because there's no origin server — we point directly to production.
 * - In a browser (dev or web), relative URLs resolve against the current origin,
 *   so we return an empty string and let Next.js handle routing normally.
 */
export function getApiBase() {
  if (
    typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.()
  ) {
    return 'https://civisly.com';
  }
  return ''; // Relative URLs work fine in the browser
}
