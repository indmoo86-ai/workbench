# Session queue V3: merge order

1. **#8** (AGENTS.md project memory) into `main`.
2. **#9** (phase 1): rebase on `main`. Expected conflict: **`package.json` `scripts.check`**, a single line. Keep both additions (`src/agents-md.mjs` from #8 and `src/collaboration-sessions.mjs`). The locale files merged cleanly in a trial merge. Run `npm run check && npm test`, then merge.
3. **#10, #11, #12, #13**, in order. After each merge, retarget the next PR to `main` (`gh pr edit <n> --base main`, or `gh api -X PATCH repos/robinli1228-ctrl/workbench/pulls/<n> -f base=main` if `gh pr edit` hits the Projects-classic error), then rebase. Each one adds to the same `scripts.check` line and to the tail of `src/locales/{en,zh}.mjs` and `public/locales/zh.js`, so after a squash merge expect small tail conflicts: keep both sides. `public/sw.js` bumps the cache version (v56 in #11, v57 in #13); keep the highest.
4. After everything is merged, the flag is still off for every project. Turn it on per project only after the four-CLI acceptance in `session-queue-v3-acceptance.md` passes.
