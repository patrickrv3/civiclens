/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',        // Produces a static `out/` folder for Capacitor
  trailingSlash: true,     // Ensures clean paths on iOS file:// serving
  images: {
    unoptimized: true,     // Required for static export (no Next.js image server)
  },
};

export default nextConfig;
