// @author denovochen
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const target = Object.freeze({
  accountId: '65413d5e43758cfe91301fb6a1ef3bc8',
  worker: 'nodewarden',
  databaseId: '28ea6259-dfee-49ef-a19f-f4d6d7a76f41',
  databaseName: 'nodewarden-db-migrated',
  bucket: 'nodewarden-attachments',
  origin: 'https://nodewarden.denovochen.workers.dev',
});
const app = resolve('app');
const sha = execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(sha, /^[a-f0-9]{40}$/);
const message = `NodeWarden upstream ${sha}`;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, target.accountId, 'Unexpected Cloudflare account');
assert.ok(token, 'CLOUDFLARE_API_TOKEN is required');

async function cf(path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${target.accountId}${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = await response.json();
  assert.ok(
    response.ok && body.success,
    `Cloudflare ${path}: HTTP ${response.status}, codes ${(body.errors ?? []).map(e => e.code).join(',')}`,
  );
  return body.result;
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
}

function output(name, value) {
  assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function settings() {
  const current = await cf(`/workers/scripts/${target.worker}/settings`);
  const bindings = current.bindings ?? [];
  assert.equal(
    bindings.find(b => b.name === 'JWT_SECRET')?.type,
    'secret_text',
    'JWT_SECRET must already exist as an encrypted runtime Secret',
  );
  const db = bindings.find(b => b.name === 'DB');
  if (db) assert.equal(db.id, target.databaseId, 'Existing Worker uses a different database');
  const attachments = bindings.find(b => b.name === 'ATTACHMENTS');
  if (attachments) assert.equal(attachments.bucket_name, target.bucket, 'Unexpected attachment bucket');
  return bindings;
}

async function activeVersion() {
  const list = await cf(`/workers/scripts/${target.worker}/deployments`);
  const versions = list.deployments?.[0]?.versions ?? [];
  if (versions.length !== 1 || versions[0].percentage !== 100) return null;
  return cf(`/workers/scripts/${target.worker}/versions/${versions[0].version_id}`);
}

async function verifyEndpoints() {
  const headers = { 'Cache-Control': 'no-cache' };
  const configResponse = await fetch(`${target.origin}/api/config`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(configResponse.status, 200, '/api/config failed');
  assert.match(configResponse.headers.get('content-type') ?? '', /application\/json/);
  const config = await configResponse.json();
  assert.equal(config.object, 'config');
  assert.equal(config.environment?.vault, target.origin);
  assert.equal(config.environment?.api, `${target.origin}/api`);
  assert.equal(config.environment?.identity, `${target.origin}/identity`);
  assert.equal(config.environment?.notifications, `${target.origin}/notifications`);

  const bootstrapResponse = await fetch(`${target.origin}/api/web-bootstrap`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(bootstrapResponse.status, 200, '/api/web-bootstrap failed');
  const bootstrap = await bootstrapResponse.json();
  assert.equal(bootstrap.jwtUnsafeReason, null, 'Runtime JWT is missing or too short');
  assert.equal(typeof bootstrap.registrationInviteRequired, 'boolean');

  const home = await fetch(target.origin, { headers, signal: AbortSignal.timeout(30000) });
  assert.equal(home.status, 200, 'Web vault failed');
  assert.match(home.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await home.text(), /NodeWarden/i);

  const sync = await fetch(`${target.origin}/api/sync`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(sync.status, 401, 'Vault sync must reject unauthenticated requests');
}

async function prepare() {
  await settings();
  const database = await cf(`/d1/database/${target.databaseId}`);
  assert.equal(database.name, target.databaseName, 'Unexpected target D1 database');
  const bucket = await cf(`/r2/buckets/${target.bucket}`);
  assert.equal(bucket.name, target.bucket, 'Target R2 bucket is unavailable');

  const config = JSON.parse(execFileSync('python3', [
    '-c',
    'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb"))))',
    resolve(app, 'wrangler.toml'),
  ], { encoding: 'utf8' }));
  const allowedKeys = new Set([
    'name', 'main', 'compatibility_date', 'compatibility_flags',
    'build', 'assets', 'triggers', 'd1_databases',
    'durable_objects', 'r2_buckets', 'migrations',
  ]);
  for (const key of Object.keys(config)) {
    assert.ok(allowedKeys.has(key), `New upstream Wrangler setting requires review: ${key}`);
  }
  assert.equal(config.name, 'nodewarden');
  assert.equal(config.main, 'src/index.ts');
  assert.equal(config.assets?.binding, 'ASSETS');
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: 'nodewarden-db' }]);
  assert.deepEqual(config.r2_buckets, [{ binding: 'ATTACHMENTS', bucket_name: 'nodewarden-attachments' }]);
  assert.deepEqual(config.durable_objects?.bindings, [
    { name: 'NOTIFICATIONS_HUB', class_name: 'NotificationsHub' },
    { name: 'BACKUP_TRANSFER_RUNNER', class_name: 'BackupTransferRunner' },
  ]);
  assert.deepEqual(config.migrations, [
    { tag: 'v1-notifications-hub', new_sqlite_classes: ['NotificationsHub'] },
    { tag: 'v2-backup-transfer-runner', new_sqlite_classes: ['BackupTransferRunner'] },
  ]);
  assert.deepEqual(config.triggers?.crons, ['*/5 * * * *']);
  config.account_id = target.accountId;
  config.workers_dev = true;
  config.preview_urls = false;
  config.d1_databases[0].database_name = target.databaseName;
  config.d1_databases[0].database_id = target.databaseId;
  delete config.build; // The workflow builds once before publishing.
  writeFileSync(resolve(app, 'wrangler.deploy.json'), `${JSON.stringify(config, null, 2)}\n`);

  const version = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8')).version;
  output('source_sha', sha);
  if (process.env.NODEWARDEN_CHECK_UPDATES === 'true') {
    const current = await activeVersion();
    if (current?.annotations?.['workers/message'] === message) {
      output('deploy', 'false');
      summary(`Official main is already deployed: \`${sha}\` (package ${version}).`);
      console.log(`No upstream changes: ${sha}`);
      return;
    }
  }
  output('deploy', 'true');
  console.log(`Preparing official NodeWarden ${version}, commit ${sha}`);
}

async function verify() {
  const bindings = await settings();
  assert.equal(bindings.find(b => b.name === 'DB')?.id, target.databaseId);
  assert.equal(bindings.find(b => b.name === 'ATTACHMENTS')?.bucket_name, target.bucket);
  for (const name of ['NOTIFICATIONS_HUB', 'BACKUP_TRANSFER_RUNNER']) {
    const binding = bindings.find(b => b.name === name);
    assert.equal(binding?.type, 'durable_object_namespace', `Missing ${name}`);
    assert.ok(binding.namespace_id, `Missing ${name} namespace`);
  }
  const current = await activeVersion();
  assert.equal(current?.annotations?.['workers/message'], message, 'Active deployment commit differs');
  await verifyEndpoints();
  console.log(`Verified production commit ${sha}`);
  summary(`Active official main verified: \`${sha}\`.\n\nApplication: ${target.origin}\n\nRuntime Secret, D1, R2, both Durable Objects, web vault, configuration/bootstrap and unauthenticated sync checks passed. Client login, vault unlock and authenticated sync require owner acceptance.`);
}

const command = process.argv[2];
if (command === 'prepare') await prepare();
else if (command === 'verify') await verify();
else throw new Error('Expected prepare or verify');
