# GitHub 与服务器同步部署

本项目以 GitHub `main` 分支作为生产代码源。推送到 `main` 后，GitHub Actions 会先执行完整构建和测试；通过后才会用 SSH 登录服务器，精确切换到该提交、重建 Docker 服务，并用 `/api/health` 返回的提交 SHA 验证部署结果。

## 1. 首次连接 GitHub

本项目生产仓库为 `https://github.com/Titus-tech-tiktok/lianrui`。在本地仓库执行：

```bash
git remote add origin https://github.com/Titus-tech-tiktok/lianrui.git
git push -u origin codex/childrenwear-mvp
```

确认当前版本后，将该分支合并到 `main`。不要把现有的 `upstream-yongsha` 当作生产远程；它只是本机旧项目参考目录。

## 2. 服务器首次准备

服务器需要安装 Git、Docker Engine、Docker Compose 插件和 curl。首次克隆：

```bash
git clone https://github.com/Titus-tech-tiktok/lianrui.git /opt/duoxiluka
cd /opt/duoxiluka
cp .env.example .env
```

在服务器的 `.env` 中配置 API 地址、API Key、至少 32 位的 `CAISHEN_SESSION_SECRET` 和 `CAISHEN_FILE_TOKEN_SECRET`。`.env`、`data/`、`output/` 都被 Git 忽略，不会随代码推送，也不会在部署同步时被删除。

服务器数据通过 `./data:/data` 持久化。上线前应为服务器 `data` 目录配置独立备份。

## 3. GitHub Environment 与 Secrets

在仓库 Settings → Environments 中创建 `production`，添加：

| Secret | 说明 |
| --- | --- |
| `DEPLOY_HOST` | 服务器域名或 IP |
| `DEPLOY_USER` | 仅用于部署的 Linux 用户 |
| `DEPLOY_SSH_PORT` | SSH 端口；不填时使用 22 |
| `DEPLOY_SSH_PRIVATE_KEY` | 部署专用私钥；对应公钥需提前加入服务器 `authorized_keys` |
| `DEPLOY_PATH` | 服务器仓库绝对路径，例如 `/opt/duoxiluka` |

再到 Settings → Secrets and variables → Actions → Variables 添加 `ENABLE_PRODUCTION_DEPLOY=true`。未设置这个开关时，推送只执行构建与测试，不会尝试连接服务器。

不需要保存服务器登录密码。部署账号只应拥有项目目录和 Docker 部署所需权限。

## 4. 日常发布与回滚

- 正常发布：把确认过的修改合并并推送到 `main`。
- 手动发布：在 Actions → Deploy → Run workflow 中填写分支、标签或提交 SHA。
- 回滚：手动运行同一工作流并填写上一个稳定提交 SHA。
- 验证：工作流只有在服务器 `/api/health` 返回本次提交 SHA 后才算成功。

部署同步会清理服务器仓库中的非 Git 临时代码，但保留被 `.gitignore` 排除的 `.env`、`data/` 和 `output/`。
