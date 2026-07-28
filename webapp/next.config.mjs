/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle known pre-converted CAD outputs into the /api/convert server function.
  // This keeps hash-verified revisions usable on Netlify, whose Next runtime does not
  // include the Docker image's dwgread/Python toolchain.
  outputFileTracingIncludes: {
    "/api/convert": ["./scripts/preconverted/**/*"],
  },
  // Docker builds set NEXT_OUTPUT=standalone for a self-contained server bundle.
  // Everywhere else (Netlify's runtime, local dev) must use the default output —
  // Netlify's Next.js runtime does not work with a standalone build.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
};

export default nextConfig;
