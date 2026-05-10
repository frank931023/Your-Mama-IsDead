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
  webpack: (config, { isServer }) => {
    // wagmi/RainbowKit pull in pino-pretty optionally; silence the warning.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // MetaMask SDK has an optional React Native dependency that emits a
    // resolve warning in web builds. Stub it out via webpack alias.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
    };
    // viem -> isows -> 'ws' (Node 端 WebSocket lib)。瀏覽器有原生 WebSocket
    // 不需要這個 npm 套件,但 bundler 看到 require('ws') 還是會炸。
    // 在 client build alias 成 false,server build (Node) 留著正常解析。
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        ws: false,
      };
    }
    return config;
  },
};

export default nextConfig;
