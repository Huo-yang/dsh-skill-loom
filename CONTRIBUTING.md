# 贡献指南

## 开发与检查

使用 Node.js 22 或更新版本。源码直接由 DSH 加载，仓库没有前端构建步骤。

```powershell
npm run check
npm pack --dry-run
```

涉及宿主行为时，把打出的 .tgz 安装到隔离的 DSH_HOME 下。为回归使用合成角色、能力族和会话，记录操作系统和实际测试的 DSH 版本。

## 提交变更

- 每次提交围绕一个行为或修复。可使用 feat、fix、docs 等 Conventional Commits 前缀。
- 用户可见的变化同步更新中英文 README 和更新记录。
- 报告问题时提供复现步骤与版本。去除令牌、私人路径、角色数据和会话日志。

## 准备版本

核对 package.json 和更新记录的版本，运行测试与打包检查，再用打包后的文件做 DSH 安装验证。GitHub 的 Release package 工作流校验版本标签并上传 tarball。正式发布前从该产物核对 npm 包名、版本和文件列表。
