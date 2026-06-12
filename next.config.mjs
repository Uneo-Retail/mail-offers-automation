/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le backend réutilisé (src/**) utilise des imports d'extension « .js » (style
  // NodeNext). On indique à webpack de résoudre « .js » vers les sources « .ts ».
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
