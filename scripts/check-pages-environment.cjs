const expectedUrl = 'https://cvkxlvdicympakfecgvv.supabase.co'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const errors = []

if (url !== expectedUrl && url !== expectedUrl + '/') {
  errors.push('NEXT_PUBLIC_SUPABASE_URL must identify the existing company project')
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY must contain a publishable browser key')
}
for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_DB_PASSWORD', 'DATABASE_PASSWORD', 'PGPASSWORD',
  'DATABASE_URL', 'DIRECT_URL']) {
  if (process.env[name]) errors.push('Privileged build environment variable is not allowed: ' + name)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('Pages environment uses the existing project and a publishable browser key')
}
