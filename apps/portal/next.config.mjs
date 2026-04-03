/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@synapse/shared'],
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
