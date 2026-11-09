/** @type {import('next').NextConfig} */
const isGithubPages =
  process.env.DEPLOY_TARGET === 'github' || process.env.GITHUB_PAGES === 'true'

const nextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  ...(isGithubPages
    ? {
        output: 'export',
        basePath: '/mingcare-intranet',
        assetPrefix: '/mingcare-intranet/',
      }
    : {}),
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
  env: {
    // Expose environment variables for build process
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

module.exports = nextConfig
