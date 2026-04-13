import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  allowedDevOrigins: ["agent-shop.localhost", "*.agent-shop.localhost"],
};

export default nextConfig;
