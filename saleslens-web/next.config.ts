import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/product-images/**",
      },
      {
        protocol: "https",
        hostname: "www.rebelrags.net",
        pathname: "/prodimages/**",
      },
      {
        protocol: "https",
        hostname: "www.utvolshop.com",
        pathname: "/site/product-images/**",
      },
    ],
  },
};

export default nextConfig;
