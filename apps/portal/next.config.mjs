import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: false,
  transpilePackages: ['@synapse/shared'],
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
