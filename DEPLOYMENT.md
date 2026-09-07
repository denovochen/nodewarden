# This Fork's Deployment

Production URL: https://nodewarden.denovochen.workers.dev

This fork targets the existing `nodewarden` Worker, `nodewarden-db` D1 database,
and `nodewarden-attachments` R2 bucket. Production resource identifiers are
pinned in `wrangler.toml`. Do not replace them with newly provisioned resources.
Never commit credentials or regenerate the existing `JWT_SECRET` during updates.

## Cloudflare Git Integration

Connect the existing Worker under Settings > Builds to `denovochen/nodewarden`:

- Production branch: `main`
- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Non-production branch builds: disabled
- Use a dedicated NodeWarden build token, not another application's token.

The integration is only operational after Cloudflare shows the repository
connection and a successful build. The presence of this file alone does not
enable automatic deployment.

## Updates Without a Local Computer

After Git integration is connected:

1. Make and verify an instance backup, including attachments, in NodeWarden.
2. Read the upstream release notes.
3. On GitHub, open this fork and choose Sync fork > Update branch.
4. Check the Cloudflare build and deployment status.
5. Verify login, synchronization, and attachment downloads.

Sync fork follows upstream `main`, not only release tags. Upstream changes do
not deploy until they reach this fork. If GitHub reports a merge conflict, stop
and resolve it while preserving the production resource identifiers; do not
discard this fork's deployment configuration.

Worker rollback does not revert D1 migrations or R2 data. Verify schema
compatibility before rolling back code. Preserve the existing JWT secret.
