# Pipboy

一个基于 Next.js 的 Pip-Boy 终端风格网页项目，包含多标签界面、地图、音频和照片外壳模式。

English version: [README_EN.md](./README_EN.md)

## 运行效果

![Pipboy Screenshot](https://roim-picx-9nr.pages.dev/rest/5dGd4Ek.png)

## 本地开发

建议使用 Node.js 20+。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000` 查看页面。

## 环境变量

请在本地或 Vercel 中配置以下变量

```bash
API_URL=https://114514.1919810.com/v1
API_MODEL=gpt-5.2,gpt-5.2-codex,gpt-5.3-codex,grok-4,grok-4-thinking,grok-4.1-expert,grok-4.20-beta
API_KEY=sk-1145141919810
```

本地可放在 `.env.local`

说明：
- `API_URL` 建议填 API 根地址（例如 `https://xxx.com/v1`），不要重复拼接路径。
- 也支持直接填到 `.../chat/completions`，后端会自动兼容。
- `API_KEY` 必须是服务端可用的真实密钥，前端不会直接读取。

## Vercel 部署

1. 将仓库导入 Vercel。
2. 在 Project Settings -> Environment Variables 中添加上面的 3 个变量，并勾选你实际使用的环境（至少 Production，建议 Preview 也配置）。
3. 触发部署即可。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
npm run start
```
