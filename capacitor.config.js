/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.civisly.app',
  appName: 'Civisly',
  webDir: 'out', // Next.js static export directory
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#6366f1',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'Default',
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
