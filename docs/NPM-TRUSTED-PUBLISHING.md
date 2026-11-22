# DSP Plugins：通过 GitHub Actions 发布到 npm

本仓库的 `.github/workflows/npm-publish.yml` 从已发布的 GitHub Release 取回原始 `.tgz`，用 npm Trusted Publishing（OIDC）发布同一份字节。DSP Plugins 的云端环境用于开发、打包和验收；npm 的信任范围是每个包和每个 GitHub workflow，**不需要在云端环境、GitHub Secrets 或 npm 配置文件保存长期发布令牌**。

## 一次性设置（包的维护者操作）

1. 审查并合并 workflow 到默认分支。为仓库创建 GitHub Actions Environment `npm-publish`，限制为默认分支（例如 `main`）。可用时配置 Required reviewers；有独立审批人时再启用 Prevent self-review。个人仓库没有独立审批人时，勾选 workflow 的发布选项仍需由包维护者明确确认，不能无人值守发版。
2. 用 GitHub Actions 手动运行 **Publish verified Loom Release to npm**，分支选择默认分支，输入已发布的稳定 tag 和独立核对的 SHA-256。第一次不要勾选 `publish`：它只做预检，不调用 npm 发布，也不用先关联 Trusted Publisher。
3. 预检通过且确认准备发版后，在 [npm package settings](https://www.npmjs.com/package/@huo-yang/dsh-skill-loom/access) 的 **Trusted Publisher** 选择 **GitHub Actions**，填 GitHub user `Huo-yang`、repository `dsh-skill-loom`、workflow filename `npm-publish.yml`、environment `npm-publish`。若界面区分权限，只允许直接 `npm publish`，不要额外授予 `npm dist-tag` 管理权限。该操作由 npm 包维护者完成；不在聊天中发送凭证。
4. 包维护者确认后，使用相同输入、勾选 `publish` 再运行，并按 GitHub Environment 的规则审批。新 Trusted Publisher 需在 2 天内首次成功发布；预检不算验证。若首次成功前已过期，删除旧绑定再创建。

## Loom v0.1.1

- Tag：`v0.1.1`（原 tag 不移动、不重打）。
- SHA-256：`7422a72ae9fd272f51bdd142a4a9d735d5c9d4f4c158e13c55f0151f896321b1`。
- Workflow 核对 tag 对应提交、同一提交上的 CI 与打包成功、GitHub Release asset digest、实际文件 SHA-256、包名、版本及仓库字段。预检和发布前都检查 npm 版本，阻止重发与降级。
- 发布后可在 [npm package](https://www.npmjs.com/package/@huo-yang/dsh-skill-loom) 核对版本与 provenance；workflow 同时验证该版本指向 `latest` 且 npm 返回的 `dist.integrity` 与上传包字节。若只在最后的 registry 读取失败，先查 npm 再决定是否重试，避免重发。
- npm provenance 会证明获授权的 dispatch workflow 在默认分支的发布行为，不会把历史 Release tarball 误称为在本次 workflow 构建；字节连续性由上述 SHA-256 与 npm integrity 校验保证。

## 其他插件按包配置

| 项目 | 推进方式 |
| --- | --- |
| Task Sound | 复用流程，替换 repo、包名和资产命名；将现有 Release manifest 中的 SHA-256 和 GitHub asset digest 对照后再放行。 |
| SSH Operator | 同上，使用该包自己的 Trusted Publisher 配置和发版负责人审批。 |
| Session Trash | 当前 `package.json` 标记 `private: true`；先保持 GitHub Release 发布。若确实要上 npm，另行评审并明确改为公开包后建立其自己的 Trusted Publisher。 |

参考：[npm 官方 Trusted Publishing 文档](https://docs.npmjs.com/trusted-publishers/)。
