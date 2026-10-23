import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep Turbopack scoped to this folder (avoids picking up stray lockfiles higher up).
  turbopack: { root: process.cwd() },
};

export default nextConfig;
