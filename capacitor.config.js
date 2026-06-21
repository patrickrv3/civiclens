/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.civisly.app',
  appName: 'Civisly',
  webDir: 'out', // Fallback local dir (not used when server.url is set)
  server: {
    // Load the live Vercel site in the native WebView.
    // This means UI updates deploy instantly to the app without new App Store builds.
    url: 'https://civisly.com',
    cleartext: false, // HTTPS only
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#6366f1',
      showSpinner: false,
    },
    StatusBar: {
      style: 'Light',
      backgroundColor: '#6366f1',
    },
  },
  ios: {
    scheme: 'Civisly',
    contentInset: 'automatic',
  },
};

module.exports = config;
