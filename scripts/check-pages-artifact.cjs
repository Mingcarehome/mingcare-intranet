const fs = require('node:fs')
const path = require('node:path')

const directory = path.resolve(process.argv[2] || 'out')
const basePath = '/mingcare-intranet/'
const errors = []
let fileCount = 0

function reject(filename, reason) {
  errors.push(path.relative(directory, filename).replaceAll('\\', '/') + ': ' + reason)
}

function scan(filename) {
  const stat = fs.lstatSync(filename)
  if (stat.isSymbolicLink()) return reject(filename, 'symbolic links are not website artifacts')
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(filename)) scan(path.join(filename, entry))
    return
  }
  fileCount++
  const relative = path.relative(directory, filename).replaceAll('\\', '/')
  if (/(?:^|\/)(?:\.(?:git|aws|codex|agents)\/|\.env(?:\.|$)|local-backups\/|local-security-audit\/|security-fix-[^/]*\/|[^/]*(?:credentials?|passwords?|secrets?|service[-_]?role|private[-_]?key|supabase[-_ ]?config|bank[-_ ]|database[-_]?(?:dump|backup))[^/]*$)/i.test(relative)
    || /\.(?:pdf|docx?|xlsx?|csv|sql|pem|key|p12|pfx|md|zip|bak|bundle)$/i.test(relative)) {
    reject(filename, 'private documents or backups are not website artifacts')
  }
  const content = fs.readFileSync(filename).toString('utf8')
  if (content.startsWith('%PDF-')) reject(filename, 'PDF content is not a website artifact')
  if (/sb_secret_[A-Za-z0-9_-]+/.test(content)) reject(filename, 'secret API key detected')
  for (const jwt of content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(jwt[0].split('.')[1], 'base64url').toString('utf8'))
      if (payload.role === 'service_role') reject(filename, 'privileged JWT detected')
    } catch { /* Ordinary text resembling a JWT is not a credential. */ }
  }
  if (/postgres(?:ql)?:\/\/[^\s/"'<>:@]+:[^\s@"'<>]+@/i.test(content)
    || /\b(?:SUPABASE_DB_PASSWORD|DATABASE_PASSWORD|PGPASSWORD)["']?\s*[:=]\s*["']?[^\s"'<>;,}]{8,}/i.test(content)) {
    reject(filename, 'database credential detected')
  }
  if (/\.html$/i.test(relative)) checkHtml(filename, content)
}

function checkHtml(filename, html) {
  let scriptCount = 0
  for (const match of html.matchAll(/\b(src|href)=["']([^"']+)["']/g)) {
    const reference = match[2]
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue
    if (!reference.startsWith(basePath)) {
      reject(filename, 'local asset or link lacks the company project path')
      continue
    }
    const asset = reference.slice(basePath.length).split(/[?#]/)[0]
    if (asset.startsWith('_next/static/') && /\.js$/.test(asset)) scriptCount++
    if (/\.(?:js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf)$/.test(asset)) {
      const target = path.resolve(directory, asset)
      if (!target.startsWith(directory + path.sep) || !fs.existsSync(target)) {
        reject(filename, 'referenced local asset is missing')
      }
    }
  }
  if (!scriptCount) reject(filename, 'no project-path application script found')
}

try {
  if (!fs.statSync(directory).isDirectory()) throw new Error('not a directory')
  for (const route of ['', 'dashboard', 'clock-records', 'notifications']) {
    const filename = path.join(directory, route, 'index.html')
    if (!fs.existsSync(filename)) reject(filename, 'required route is missing')
  }
  scan(directory)
} catch {
  errors.push('Cannot read the complete Pages export directory')
}

if (errors.length) {
  // Report file locations and categories only; never print matched credentials.
  console.error([...new Set(errors)].join('\n'))
  process.exitCode = 1
} else {
  console.log('Pages artifact passed credential, document, route and asset checks (' + fileCount + ' files)')
}
