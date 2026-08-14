import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chrome profiles + screenshot dumps must not be NFT-traced (tens of thousands of files).
  outputFileTracingExcludes: {
    "/*": [
      "./.teams-session/**/*",
      "./.zalo-session/**/*",
      "./teams-screenshots/**/*",
      "./zalo-screenshots/**/*",
      "./demo/**/*",
    ],
  },
};

export default nextConfig;
