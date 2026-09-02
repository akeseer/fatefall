# Run Doc — rpg-ai-party

## How to reproduce artifacts

1. `cd rpg-ai-party`
2. `npm install` (installs Vite + TypeScript devDependencies)

No `.env.local` or other config files needed — Vite serves the `index.html` at project root with default settings.

## How to run the server

```bash
cd rpg-ai-party
npm run dev
```

This starts Vite's dev server on **http://localhost:5173** (default port).

- HMR is enabled by default — edits to `.ts` files in `src/` are reflected immediately.
- `npm run build` produces a static build in `dist/`.
