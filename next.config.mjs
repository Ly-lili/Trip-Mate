import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['@modelcontextprotocol/sdk', 'openai'],
  webpack: (config) => {
    // src/ uses NodeNext-style ".js" import specifiers that resolve to .ts files
    // — tell webpack to fall back to .ts/.tsx when ".js" is missing.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
