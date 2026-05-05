/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "cloudflare-ipfs.com" },
      { protocol: "https", hostname: "arweave.net" },
    ],
  },
  webpack: (config) => {
    // wagmi/RainbowKit pull in pino-pretty optionally; silence the warning.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // MetaMask SDK has an optional React Native dependency that emits a
    // resolve warning in web builds. Stub it out via webpack alias.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
