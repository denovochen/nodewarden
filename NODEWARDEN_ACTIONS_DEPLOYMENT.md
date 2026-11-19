# NodeWarden Actions 部署

此 Fork 的部署工作流为 `.github/workflows/deploy-nodewarden-actions.yml`。应用源码从官方 `shuaiplus/nodewarden` 的 `main` 获取，在 GitHub Actions 构建后通过 Wrangler 发布；无需 Cloudflare Workers Builds 连接或 Deploy Hook。Fork 中原有应用源码不会被自动同步，线上源码以工作流记录的官方提交为准。

## 固定目标

| 项目 | 配置 |
| --- | --- |
| Cloudflare 账户 | `Denovochen@gmail.com` / `65413d5e43758cfe91301fb6a1ef3bc8` |
| Worker | `nodewarden` |
| 地址 | `https://nodewarden.denovochen.workers.dev` |
| D1 | `nodewarden-db-migrated` / `28ea6259-dfee-49ef-a19f-f4d6d7a76f41` |
| R2 | `nodewarden-attachments` |
| Durable Objects | `NOTIFICATIONS_HUB`、`BACKUP_TRANSFER_RUNNER` |
| 运行时 Secret | `JWT_SECRET`，仅保存在 Cloudflare |

`nodewarden-db-migrated` 用于迁入 Codpf1026 账户的原 NodeWarden 数据；迁移前核实原库为 0 用户、0 密码项、0 附件。Denovochen 账户原有 `nodewarden-db`（1 用户、286 条密码项）独立保留，当前 Worker 不使用该库。

GitHub 仓库需设置两个加密 Secrets：

- `CLOUDFLARE_ACCOUNT_ID`：上表账户 ID。
- `CLOUDFLARE_API_TOKEN`：仅限目标账户，具有 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Account Settings Read。

Token 和 JWT 不得写入代码、Actions 日志、Issue 或构建产物。源账户的临时导出 Token 不存入 GitHub。工作流只授予 `contents: read`，不通过仓库写入更新应用源码。

## 更新与检查

在 Actions → **Deploy NodeWarden with GitHub Actions** → **Run workflow** 选择 `main` 可手动重部署；勾选 `check_updates` 则使用自动更新的检查方式，同提交跳过发布。工作流每天北京时间 03:00（前一天 19:00 UTC，cron 为 `0 19 * * *`）检查官方 `main`，仅新提交触发自动发布。工作流使用官方 `.node-version` 和 `package-lock.json`，执行现有配置、密码库、加密、通知安全测试及前端构建。

每次发布前检查账户、D1、R2 与运行时 Secret，生成带明确数据库 UUID 的实例配置。上游新增绑定、迁移或未知 Wrangler 配置时停止，需审查适配。运行时 Secret 保留；Worker 版本消息记录完整官方提交，作为更新判断依据。相同提交跳过发布时仍检查公开接口。

发布后验证生产版本占比、提交、D1/R2/DO 绑定、JWT 配置、主页、`/api/config`、`/api/web-bootstrap`，以及未登录访问 `/api/sync` 返回 401。`/api/config` 中的 `version` 是 Bitwarden 协议兼容版本，应用包版本和实际代码提交见 Actions 日志。

GitHub 可能停用长期无仓库活动的定时工作流；若未按期运行，在 Actions 检查并重新启用。密码库的实际注册、登录、解锁、附件读写及客户端同步由实例所有者验收，不以公开接口检查替代。

## 迁移及回退

源 Worker、D1、R2 与 DO 保留，生产/预览入口、Cron 和 Workers Builds 在最终快照前暂停。源 JWT 原值作为目标的运行时加密 Secret。导出 SQL 和配置备份仅保存在操作者的受限本机目录，不进入仓库或 Actions 产物。

若切换失败，停止目标入口及定时任务，再恢复源 Worker 入口和原 `*/5 * * * *` Cron；源数据未被目标覆盖。开始在目标写入后，回退前必须评估新增数据，不能用旧快照覆盖。目标账户原有独立 `nodewarden-db` 不参与此回退。

管理员需将客户端服务器地址切换为新的 Worker 地址。两个账户的数据库不会双向同步。
