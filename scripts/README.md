# Script notes

## `bump-and-deploy.mjs`

Use this for the one-step frontend release prep flow:

```bash
npm run bump:build -- 2.8.2
```

It runs:

1. `npm run bump:version -- <version>`
2. `npm run deploy:bauklank-studio`

This is useful when you want one command that both updates the frontend version metadata and builds/deploys the frontend bundle into `web/serial-logger-app`.
