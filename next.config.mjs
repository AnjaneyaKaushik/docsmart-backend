/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // All specific body parsing limits or API route configs
  // are removed from here as they are not being recognized.
  // File parsing will now be handled directly by formidable in the API route.
};

export default nextConfig;
