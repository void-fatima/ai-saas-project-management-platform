import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This command owns a unique Compose project and destroys ONLY that project's
// disposable volume on exit. Never accepts a production project or env file.
const project = `platform-ops-smoke-${process.pid}`;
const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const sentinel = `server-only-${randomBytes(16).toString('hex')}`;
const env = {
  ...process.env,
  POSTGRES_DB: 'platform',
  POSTGRES_USER: 'platform_migrator',
  POSTGRES_PASSWORD: adminPassword,
  APP_DATABASE_PASSWORD: appPassword,
  DATABASE_URL: `postgresql://platform_app:${appPassword}@postgres:5432/platform?schema=public`,
  MIGRATION_DATABASE_URL: `postgresql://platform_migrator:${adminPassword}@postgres:5432/platform?schema=public`,
  WEB_ORIGIN: 'https://app.example.com',
  WEB_PORT: '0',
  IMAGE_TAG: 'ops-smoke',
  MAIL_MODE: 'disabled',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: '',
  AI_PROVIDER: 'disabled',
  AI_MODEL: '',
  AI_API_KEY: sentinel,
  LOG_LEVEL: 'info',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_MS: '60000',
  SESSION_TTL_HOURS: '168',
  SESSION_ROTATION_HOURS: '24',
  SESSION_ABSOLUTE_HOURS: '720',
};
const cwd = fileURLToPath(new URL('..', import.meta.url));
const prefix = [
  'compose',
  '--env-file',
  '.env.production.example',
  '-f',
  'compose.production.yaml',
  '-p',
  project,
];
function compose(args, { fails = false } = {}) {
  const result = spawnSync('docker', [...prefix, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || (fails ? result.status === 0 : result.status !== 0)) {
    let detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    for (const secret of [adminPassword, appPassword, sentinel])
      detail = detail.replaceAll(secret, '[redacted]');
    throw new Error(
      `Compose ${args[0]} ${fails ? 'unexpectedly succeeded' : 'failed'}: ${detail.split('\n').slice(-25).join('\n')}`,
    );
  }
  return result.stdout.trim();
}
function sql(database, query, user = 'platform_migrator', options) {
  return compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      user,
      '-d',
      database,
      '-Atc',
      query,
    ],
    options,
  );
}

compose(['config', '--quiet']);
console.log('Production Compose configuration passed.');
if (!process.argv.includes('--config-only')) {
  let failure;
  try {
    compose(['build']);
    console.log('API, migration and web images built.');
    for (const service of ['api', 'web', 'migrate']) {
      assert.notEqual(
        compose(['run', '--rm', '--no-deps', '--entrypoint', 'id', service, '-u']),
        '0',
        `${service} must run as a non-root user`,
      );
    }
    const migrationUrl = env.MIGRATION_DATABASE_URL;
    env.MIGRATION_DATABASE_URL = 'postgresql://invalid:invalid@postgres:5432/platform';
    compose(['up', '-d', '--wait', '--wait-timeout', '180'], { fails: true });
    assert.ok(
      !compose(['ps', '--status', 'running', '--services']).split('\n').includes('api'),
      'Migration failure must prevent API startup',
    );
    env.MIGRATION_DATABASE_URL = migrationUrl;
    compose([
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '180',
      '--force-recreate',
      'migrate',
      'api',
      'web',
    ]);
    compose(['run', '--rm', 'migrate']);
    compose(['run', '--rm', '--no-deps', '-e', 'WEB_ORIGIN=http://insecure.example.com', 'api'], {
      fails: true,
    });
    assert.equal(
      sql('platform', 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'),
      '10',
    );
    assert.equal(
      sql('platform', "SELECT rolsuper FROM pg_roles WHERE rolname='platform_app'"),
      'f',
    );
    sql('platform', 'CREATE TABLE forbidden_test(id int)', 'platform_app', { fails: true });
    const address = compose(['port', 'web', '8080']);
    const origin = `http://${address}`;
    async function http(path, options) {
      return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
    }
    for (const path of ['/healthz', '/api/health', '/api/ready', '/api/health/ready']) {
      const response = await http(path);
      assert.equal(response.status, 200, path);
      await response.text();
    }
    const index = await (await http('/')).text();
    assert.equal(await (await http('/projects/deep-link')).text(), index);
    for (const [, asset] of index.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
      const content = await (await http(asset)).text();
      for (const secret of [adminPassword, appPassword, sentinel])
        assert.ok(!content.includes(secret), 'No server secrets in assets');
      if (asset.endsWith('.js'))
        assert.ok(!content.includes('Developer system panel'), 'No developer panel in production');
    }
    const headers = {
      'Content-Type': 'application/json',
      Origin: env.WEB_ORIGIN,
      'X-Real-IP': '192.0.2.5',
    };
    const registration = await http('/api/auth/register', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Operations smoke',
        email: 'smoke@example.com',
        password: randomBytes(24).toString('hex'),
      }),
    });
    assert.equal(registration.status, 201, await registration.text());
    const cookie = registration.headers.get('set-cookie');
    assert.match(cookie, /__Host-platform_session=/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    headers.Cookie = cookie.split(';')[0];
    assert.equal((await http('/api/auth/me', { headers })).status, 200);
    const workspace = await http('/api/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Smoke workspace' }),
    });
    assert.equal(workspace.status, 201, await workspace.text());
    // Forwarding is overwritten by the web proxy: forged X-Forwarded-For cannot evade limits.
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await http('/api/auth/login', {
        method: 'POST',
        headers: { ...headers, 'X-Forwarded-For': `198.51.100.${attempt}` },
        body: '{}',
      });
      assert.equal(response.status, attempt === 5 ? 429 : 400);
      await response.text();
    }
    assert.equal(sql('platform', 'SELECT count(*) FROM audit_events'), '1');
    sql('platform', 'DELETE FROM audit_events', 'platform_app', { fails: true });
    compose([
      'exec',
      '-T',
      '-e',
      'PGDATABASE=platform',
      '-e',
      'PGUSER=platform_migrator',
      'postgres',
      'sh',
      '/operations/backup.sh',
      '/tmp/smoke.dump',
    ]);
    compose(
      [
        'exec',
        '-T',
        '-e',
        'PGDATABASE=platform',
        '-e',
        'PGUSER=platform_migrator',
        'postgres',
        'sh',
        '/operations/backup.sh',
        '/tmp/smoke.dump',
      ],
      { fails: true },
    );
    sql('platform', 'CREATE DATABASE platform_restore');
    const restore = [
      'exec',
      '-T',
      '-e',
      'PGDATABASE=platform_restore',
      '-e',
      'PGUSER=platform_migrator',
      '-e',
      'RESTORE_TARGET_CONFIRM=platform_restore',
      'postgres',
      'sh',
      '/operations/restore.sh',
      '/tmp/smoke.dump',
    ];
    compose(restore);
    assert.equal(sql('platform_restore', 'SELECT count(*) FROM users'), '1');
    assert.equal(sql('platform_restore', 'SELECT count(*) FROM audit_events'), '1');
    assert.equal(
      sql(
        'platform_restore',
        'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      ),
      '10',
    );
    sql('platform_restore', 'DELETE FROM audit_events', 'platform_migrator', { fails: true });
    compose(restore, { fails: true });
    console.log(
      'HTTP, SPA, secure cookies, database role, rate limits, migrations and backup/restore checks passed.',
    );
    compose(['stop', 'postgres']);
    assert.equal((await http('/api/health')).status, 200);
    assert.equal((await http('/api/ready')).status, 503);
    compose(['start', '--wait', 'postgres']);
    // A real SIGTERM, including an open authenticated SSE stream, must close normally.
    const stream = await http('/api/realtime', { headers });
    assert.equal(stream.status, 200);
    compose(['stop', 'api']);
    const stopped = JSON.parse(compose(['ps', '-a', '--format', 'json', 'api']));
    const status = Array.isArray(stopped) ? stopped[0] : stopped;
    assert.equal(status.ExitCode, 0);
    await stream.body.cancel();
    const logs = compose(['logs', '--no-color', 'api']);
    assert.ok(logs.includes('shutdown_complete'));
    for (const secret of [adminPassword, appPassword, sentinel, headers.Cookie])
      assert.ok(!logs.includes(secret));
    console.log('Database outage readiness and SIGTERM/SSE shutdown passed.');
  } catch (error) {
    failure = error;
  } finally {
    try {
      compose(['down', '--volumes', '--remove-orphans']);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  console.log('Production smoke stack stopped and its disposable volume removed.');
}
