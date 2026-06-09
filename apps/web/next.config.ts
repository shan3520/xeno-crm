import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @xeno/shared ships compiled CJS, but transpiling it keeps source-level imports
  // working seamlessly if the package later exports TS directly.
  transpilePackages: ["@xeno/shared"],
};

export default nextConfig;
