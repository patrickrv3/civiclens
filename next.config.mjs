/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        // Proxy Firebase auth handler so OAuth redirects stay in the WebView
        source: '/__/auth/:path*',
        destination: 'https://civiclens-8b866.firebaseapp.com/__/auth/:path*',
      },
    ];
  },
};

export default nextConfig;
