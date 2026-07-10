/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.civisly.app',
  appName: 'Civisly',
  webDir: 'out', // Fallback local dir (not used when server.url is set)
  server: {
    // Load the live Vercel site in the native WebView.
    // This means UI updates deploy instantly to the app without new App Store builds.
    url: 'https://www.civisly.com',
    cleartext: false, // HTTPS only
    // Allow Firebase auth and Google sign-in to stay in the WebView
    allowNavigation: [
      'civiclens-8b866.firebaseapp.com',
      '*.firebaseapp.com',
      'accounts.google.com',
      '*.google.com',
      '*.googleapis.com',
    ],
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
    contentInset: 'never',
    backgroundColor: '#f5f6f8',
  },
};

module.exports = config;
