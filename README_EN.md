# Pipboy

A Next.js-based Pip-Boy styled web project with multi-tab UI, map view, audio playback, and photo-shell mode.

## Preview

![Pipboy Screenshot](https://roim-picx-9nr.pages.dev/rest/5dGd4Ek.png)

## Local Development

Recommended: Node.js 20+

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Environment Variables

Configure these variables locally or in Vercel (do not commit secrets):

```bash
API_URL=https://your-api-base/v1
API_MODEL=gpt-5.2,gpt-5.2-codex,gpt-5.3-codex,grok-4,grok-4-thinking,grok-4.1-expert,grok-4.20-beta
API_KEY=your_api_key
```

For local development, put them in `.env.local`.

## Deploy on Vercel

1. Import this repository in Vercel.
2. Add the 3 environment variables in Project Settings -> Environment Variables.
3. Trigger deployment.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```
