/** @type {import('next').NextConfig} */
const nextConfig = {
  // GitHub Pages static export configuration
  output: 'export',
  distDir: 'out',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  // GitHub Pages configuration
  basePath: '/mingcare-intranet',
  assetPrefix: '/mingcare-intranet/',
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
  env: {
    // Expose environment variables for build process
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

module.exports = nextConfig
