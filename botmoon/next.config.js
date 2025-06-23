// const withBundleAnalyzer = require("@next/bundle-analyzer")({
//   enabled: process.env.ANALYZE === "true",
// });

// /** @type {import('next').NextConfig} */
// const nextConfig = {
//   reactStrictMode: true, // Added this as it was in the bundle analyzer example
//   eslint: {
//     ignoreDuringBuilds: true,
//   },
//   images: { unoptimized: true },
//   output: "standalone", // Remove 'export' so middleware can work
// };

// module.exports = withBundleAnalyzer(nextConfig);

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  output: "standalone",
  allowedDevOrigins: ['192.168.137.1'],

  async headers() {
    return [
      {
        source: "/(.*)", // Apply CSP to all routes
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; connect-src 'self' https://api.nowpayments.io;",
          },
        ],
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
