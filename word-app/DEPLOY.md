# 部署说明 · Cloudflare Pages

> 最近更新：2026-11-16
> 本文档回答：怎么把 word-app 上线到 Cloudflare Pages。**不回答**：代码怎么改（看 `../README.md`）。
> 目标：把本目录构建的静态产物部署到 `https://xxx.pages.dev`，公开访问，PWA 可装、离线可用。

## 0. 前提（已满足）

- 纯前端静态应用，无后端、无账号、无云同步
- 数据存各访问者浏览器 IndexedDB（各人独立，不互通——这是设计，非缺陷）
- 词库内嵌构建（1238 词），**公开访问 = 词库随 JS 公开**（已确认接受）
- 访问者可自行「词库设置 → 导入新词书」上传 .md/.csv/.txt
- PWA 已配（manifest + service worker + 图标），HTTPS 下手机可装、离线可用
- 构建产物 `dist/` 约 485KB

## 1. 一次性准备（你来做，约 5 分钟）

1. 注册 Cloudflare 账号：https://dash.cloudflare.com/sign-up （免费）
2. 确保本仓库（`sir-yaoyue/IELTS-test`）在 GitHub 上（已推送，私有仓库 Cloudflare Pages 免费额度内可连）

## 2. 在 Cloudflare 创建 Pages 站点（你来做）

1. 登录 Cloudflare Dashboard → 左侧 **Workers & Pages** → **Create** → **Pages** 标签 → **Connect to Git**
2. 授权 GitHub（首次会弹授权页，选仓库权限）
3. 选择仓库 `sir-yaoyue/IELTS-test`
4. **构建配置**（关键，照填）：
   - **Project name**：随意，如 `word-app`（决定网址前缀 `word-app.pages.dev`）
   - **Production branch**：`main`
   - **Build command**：`pnpm install && pnpm build`
   - **Build output directory**：`dist`
   - **Root directory**：`word-app` ⚠️ 重要——本应用代码在仓库的 `word-app/` 子目录，不是仓库根，必须填这个
   - **Environment variables**（构建环境）：
     - `npm_config_store_dir` 留空即可（Cloudflare 用自带 pnpm）
     - 若报 pnpm 版本问题，加 `CI` = `true`
5. 点 **Save and Deploy**

## 3. 验证部署（你做 + 我可协助）

1. Cloudflare 页面会显示构建进度（约 1-2 分钟）
2. 成功后得到网址 `https://<project>.pages.dev`
3. 浏览器打开 → 应看到「单词本 · 首次设置」→ 点「导入内置词库」→ 进入今日页
4. 手机访问同一网址 → 浏览器菜单「添加到主屏幕」→ PWA 安装成功
5. 把网址发我，我用 headless 验证线上版功能（导入/学习/统计/选词）与本地一致

## 4. 自动更新（部署后自动）

- 你每次 `git push` 到 `main` → Cloudflare 自动重新构建部署
- 预览分支：非 main 分支的 push 会生成**预览 URL**（临时），便于先验证再合并
- 回滚：Pages 站点 → **Deployments** → 选旧版本 → **Deploy**（一键回滚）

## 5. 常见问题

| 问题 | 处置 |
|---|---|
| 构建报 pnpm 找不到 | Cloudflare 环境自带 pnpm；若仍报错，Build command 改 `corepack enable && pnpm install && pnpm build` |
| 构建报 esbuild 脚本被忽略 | 本仓库 `word-app/pnpm-workspace.yaml` 已配 `allowBuilds: esbuild`，Cloudflare 构建会读它；若仍报错，加环境变量 `npm_config_enable_pre_post_scripts` = `true` |
| 网址 404 | 确认 Root directory 填了 `word-app`、Build output 填了 `dist` |
| PWA 装不了 | 确认走 HTTPS（pages.dev 默认是）；iOS 用 Safari「分享→添加到主屏幕」 |
| 想换自定义域名 | Pages 站点 → **Custom domains** → 加域名（需域名也在 Cloudflare 或配 CNAME） |

## 6. 数据与合规备忘

- 公开访问：任何人可用，**各人数据独立**（IndexedDB 按浏览器隔离），无共享、无追踪
- 词库公开：1238 词随构建 JS 暴露（已确认接受）
- 无后端、无账号、无个人信息收集 → **不触发个保法**（不收集手机号/账号/位置等）
- 访问者若「导入自己的词库」，数据也只存其自己浏览器，不经服务器

## 7. 回退/下线

- 临时下线：Pages 站点 → **Delete**（网址即失效，仓库不受影响）
- 仅暂停：把 Production branch 改成一个不构建的分支，或暂停站点
