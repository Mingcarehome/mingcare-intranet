const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const test = require('node:test')

// Use the normal installed dependencies, or an existing offline installation.
const dependencyRequire = process.env.LEGACY_TEST_NODE_MODULES
  ? createRequire(path.join(process.env.LEGACY_TEST_NODE_MODULES, '..', 'package.json'))
  : require
const ts = dependencyRequire('typescript')
const projectRoot = path.resolve(__dirname, '..')

function loadSource(relativePath, replacements = {}, globals = {}) {
  const cache = new Map()
  const context = vm.createContext({ console, process, ...globals })
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText
    const localRequire = (name) => {
      if (Object.hasOwn(replacements, name)) return replacements[name]
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'))
      return dependencyRequire(name)
    }
    const execute = vm.runInContext('(function(require, module, exports) {' + javascript + '\n})', context)
    execute(localRequire, module, module.exports)
    return module.exports
  }
  return { exports: load(path.join(projectRoot, relativePath)), load }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('legacy collection queries use the signed-in and refreshed session with a public API key', async () => {
  const sdk = dependencyRequire('@supabase/supabase-js')
  const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({
    sub: 'company-user', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url'), 'synthetic-signature'].join('.')
  let activeToken = token
  const storage = memoryStorage({ mingcare_password: 'legacy-saved-password',
    mingcare_email: 'member@example.invalid', mingcare_remember: 'true' })
  const clients = []
  const requests = []
  const publicKey = 'synthetic-public-key'
  const user = {
    id: 'company-user', aud: 'authenticated', role: 'authenticated',
    email: 'member@example.invalid', app_metadata: {}, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  }
  const fetch = async (url, options = {}) => {
    const requestUrl = new URL(url)
    const headers = new Headers(options.headers)
    if (requestUrl.pathname === '/auth/v1/token') {
      if (requestUrl.searchParams.get('grant_type') === 'refresh_token') {
        activeToken = token.replace('synthetic-signature', 'refreshed-signature')
      }
      return Response.json({ access_token: activeToken, token_type: 'bearer', refresh_token: 'synthetic-refresh',
        expires_in: 3600, user })
    }
    if (requestUrl.pathname.startsWith('/rest/v1/')) {
      requests.push({ url: requestUrl, headers })
      return headers.get('Authorization') === 'Bearer ' + activeToken
        ? Response.json([{ id: 'visible-record' }])
        : Response.json({ message: 'Authenticated session required' }, { status: 403 })
    }
    throw new Error('Unexpected offline request: ' + requestUrl.pathname)
  }
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://company.example.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-privileged-key' }
  const scope = loadSource('lib/supabase-admin.ts', {
    '@supabase/supabase-js': {
      createClient: (url, key, options = {}) => {
        const client = sdk.createClient(url, key, { ...options,
          global: { ...options.global, fetch }, auth: { ...options.auth, storage } })
        clients.push(client)
        return client
      },
    },
  }, { window: { localStorage: storage }, process: { env } })
  try {
    const normal = scope.load(path.join(projectRoot, 'lib/supabase.ts')).supabase
    assert.equal(storage.getItem('mingcare_password'), null, 'a dashboard client clears legacy plaintext without mounting login')
    assert.equal(storage.getItem('mingcare_email'), 'member@example.invalid')
    assert.equal(storage.getItem('mingcare_remember'), 'true')
    const signedIn = await normal.auth.signInWithPassword({ email: user.email, password: 'synthetic-password' })
    assert.equal(signedIn.error, null)
    const clock = await scope.exports.supabaseAdmin.from('clock_records').select('*')
      .order('clock_time', { ascending: false })
    assert.equal(clock.error, null, 'clock query must retain the login session')
    assert.deepEqual(clock.data, [{ id: 'visible-record' }])
    const notifications = await scope.exports.getSupabaseAdmin().from('notifications').select('*')
      .eq('is_deleted', false).order('created_at', { ascending: false })
    assert.equal(notifications.error, null)
    assert.deepEqual(notifications.data, [{ id: 'visible-record' }])
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(request.headers.get('apikey'), publicKey)
      assert.equal(request.headers.get('Authorization'), 'Bearer ' + token)
    }
    assert.equal(requests[1].url.searchParams.get('is_deleted'), 'eq.false')
    assert.ok(storage.getItem('sb-company-auth-token'), 'login remains persisted for navigation/reloads')
    assert.equal((await normal.auth.refreshSession()).error, null)
    assert.equal((await scope.exports.supabaseAdmin.from('clock_records').select('*')).error, null)
    assert.equal(requests[2].headers.get('Authorization'), 'Bearer ' + activeToken)
    assert.notEqual(activeToken, token, 'the collection client follows refreshed session tokens')
  } finally {
    for (const client of clients) await client.auth.stopAutoRefresh()
  }
})

test('server rendering does not create a browser database client', () => {
  const scope = loadSource('lib/supabase-admin.ts', {
    '@supabase/supabase-js': { createClient: () => { throw new Error('Unexpected client during SSR') } },
  })
  assert.equal(scope.exports.supabaseAdmin, null)
  assert.equal(scope.exports.getSupabaseAdmin(), null)
})

test('resolved Next configurations do not expose a privileged environment key', () => {
  for (const filename of ['next.config.js', 'next.config.github.js']) {
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(projectRoot, filename), 'utf8'), {
      module, process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'synthetic-privileged-key' } },
    })
    assert.equal(JSON.stringify(module.exports).includes('synthetic-privileged-key'), false, filename)
  }
})

function loginHarness(storage, initialStates = []) {
  const React = dependencyRequire('react')
  const values = [...initialStates]
  const effects = []
  let index = 0
  const LoginPage = loadSource('app/page.tsx', {
    react: { ...React, useState: (initial) => {
      const slot = index++
      if (!(slot in values)) values[slot] = initial
      return [values[slot], (value) => { values[slot] = value }]
    }, useEffect: (callback) => { effects.push(callback) } },
    'next/navigation': { useRouter: () => ({ push() {} }) },
    'next/image': { __esModule: true, default: () => null },
    '../lib/supabase': { supabase: { auth: { signInWithPassword: async () => ({ data: { user: { id: 'member' } }, error: null }) } } },
    '../utils/asset-path': { getAssetPath: (value) => value },
  }, { localStorage: storage }).exports.default
  return { render: () => { index = 0; return LoginPage() }, effects }
}

function findElement(element, predicate) {
  if (!element || typeof element !== 'object') return undefined
  if (predicate(element)) return element
  return [element.props?.children].flat(Infinity)
    .map((child) => findElement(child, predicate)).find(Boolean)
}

test('login clears a legacy stored password and restores only the remembered email', () => {
  const storage = memoryStorage({ mingcare_password: 'old-password',
    mingcare_email: 'remembered@example.invalid', mingcare_remember: 'true' })
  const page = loginHarness(storage)
  page.render()
  page.effects.forEach((effect) => effect())
  const rendered = page.render()
  assert.equal(storage.getItem('mingcare_password'), null)
  assert.equal(findElement(rendered, (el) => el.props?.name === 'email').props.value, 'remembered@example.invalid')
  assert.equal(findElement(rendered, (el) => el.props?.name === 'password').props.value, '')
})

test('remembering a successful login persists email without saving the password', async () => {
  const storage = memoryStorage()
  const page = loginHarness(storage, ['member@example.invalid', 'new-password', true])
  const form = findElement(page.render(), (el) => el.type === 'form')
  await form.props.onSubmit({ preventDefault() {} })
  assert.equal(storage.getItem('mingcare_email'), 'member@example.invalid')
  assert.equal(storage.getItem('mingcare_remember'), 'true')
  assert.equal(storage.getItem('mingcare_password'), null)
})

for (const route of ['billing-salary-management', 'search-customers', 'search-care-staff']) {
  test(route + ' errors do not log personal payloads', async () => {
    const privateValue = 'SYNTHETIC_PRIVATE_RECORD'
    const logs = []
    const query = { from() { return this }, insert() { return this }, select() { return this },
      or() { return this }, limit() { return this },
      then(resolve) { return Promise.resolve({ data: null, error: { message: privateValue, details: privateValue } }).then(resolve) } }
    const handler = loadSource('app/api/' + route + '/route.ts', {
      'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
      '@/lib/supabase-server': { createSupabaseServerClient: () => query },
    }, { console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) } }).exports.POST
    const body = { searchTerm: privateValue, customer_name: privateValue, care_staff_name: privateValue,
      service_date: '2026-01-01', staff_id: 'synthetic-staff' }
    assert.equal((await handler({ json: async () => body })).status, 500)
    assert.equal((await handler({ json: async () => { throw new Error(privateValue) } })).status, 500)
    if (route === 'billing-salary-management') {
      assert.equal((await handler({ json: async () => ({ customer_name: privateValue }) })).status, 400)
    }
    assert.equal(JSON.stringify(logs).includes(privateValue), false, route)
  })
}

function runCheck(script, args = [], environment = {}) {
  return spawnSync(process.execPath, [path.join(projectRoot, 'scripts', script), ...args], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, ...environment },
  })
}

test('Pages environment check accepts only the old project with a publishable browser key', () => {
  const valid = { NEXT_PUBLIC_SUPABASE_URL: 'https://cvkxlvdicympakfecgvv.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_synthetic_browser_key' }
  assert.equal(runCheck('check-pages-environment.cjs', [], valid).status, 0)
  for (const invalid of [
    { ...valid, NEXT_PUBLIC_SUPABASE_URL: '' },
    { ...valid, NEXT_PUBLIC_SUPABASE_URL: 'https://another-project.supabase.co' },
    { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
    { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJ-synthetic-legacy-key' },
    { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_synthetic_server_key' },
    { ...valid, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-privileged-key' },
  ]) {
    const result = runCheck('check-pages-environment.cjs', [], invalid)
    assert.notEqual(result.status, 0)
    assert.equal((result.stdout + result.stderr).includes('synthetic'), false, 'validation never prints key values')
  }
})

function withPagesFixture(check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mingcare-pages-test-'))
  try {
    fs.mkdirSync(path.join(directory, '_next/static'), { recursive: true })
    fs.writeFileSync(path.join(directory, '_next/static/app.js'), 'console.log("public website");')
    for (const route of ['', 'dashboard', 'clock-records', 'notifications']) {
      fs.mkdirSync(path.join(directory, route), { recursive: true })
      fs.writeFileSync(path.join(directory, route, 'index.html'),
        '<!doctype html><script src="/mingcare-intranet/_next/static/app.js"></script>')
    }
    check(directory)
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('Pages artifact check accepts complete project-path assets and public browser keys', () => {
  withPagesFixture((directory) => {
    fs.appendFileSync(path.join(directory, '_next/static/app.js'),
      '\nconst browserKeys = ["sb_publishable_synthetic_browser_key", "AIzaSyntheticGoogleBrowserKey"];')
    assert.equal(runCheck('check-pages-artifact.cjs', [directory]).status, 0)
  })
})

test('Pages artifact check rejects privileged credentials and private documents without printing them', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9',
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'), 'synthetic_signature'].join('.')
  for (const content of [jwt, 'sb_secret_synthetic_server_key',
    'postgresql://postgres:synthetic-database-password@db.example.invalid/postgres',
    'SUPABASE_DB_PASSWORD="synthetic-database-password"']) {
    withPagesFixture((directory) => {
      fs.appendFileSync(path.join(directory, '_next/static/app.js'), '\n' + content)
      const result = runCheck('check-pages-artifact.cjs', [directory])
      assert.notEqual(result.status, 0)
      assert.equal((result.stdout + result.stderr).includes(content), false)
    })
  }
  for (const filename of ['bank-statement.pdf', 'credentials.txt', 'supabase-config 2.txt',
    'database-backup.sql', 'repository-history.bundle']) {
    withPagesFixture((directory) => {
      fs.writeFileSync(path.join(directory, filename), 'synthetic private document')
      assert.notEqual(runCheck('check-pages-artifact.cjs', [directory]).status, 0)
    })
  }
})

test('Pages artifact check rejects missing routes, broken assets and wrong project paths', () => {
  for (const mutation of [
    (directory) => fs.unlinkSync(path.join(directory, 'dashboard/index.html')),
    (directory) => fs.unlinkSync(path.join(directory, '_next/static/app.js')),
    (directory) => fs.writeFileSync(path.join(directory, 'clock-records/index.html'),
      '<script src="/_next/static/app.js"></script>'),
  ]) {
    withPagesFixture((directory) => {
      mutation(directory)
      assert.notEqual(runCheck('check-pages-artifact.cjs', [directory]).status, 0)
    })
  }
})
