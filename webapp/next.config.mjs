/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker builds set NEXT_OUTPUT=standalone for a self-contained server bundle.
  // Everywhere else (Netlify's runtime, local dev) must use the default output —
  // Netlify's Next.js runtime does not work with a standalone build.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
};

export default nextConfig;
