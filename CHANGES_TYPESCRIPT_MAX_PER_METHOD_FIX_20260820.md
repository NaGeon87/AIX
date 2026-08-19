# TypeScript build fix — MAX_PER_METHOD (2026-08-20)

- Vercel TypeScript error: `app/how/page.tsx(87,57): Cannot find name 'MAX_PER_METHOD'`
- `web/lib/recommend.ts` already exports `MAX_PER_METHOD`, but `web/app/how/page.tsx` referenced it without importing it.
- Added `MAX_PER_METHOD` to the named import from `@/lib/recommend`.
- Searched the project for `MAX_PER_METHOD` / `MAX_PER_INGREDIENT` references to confirm the remaining references resolve to exported constants.
