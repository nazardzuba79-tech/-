# Stocks-global runtime package proof

This is a finite, local packaging/recovery proof. It does not create a production deployment image, change the existing reader Dockerfile, install dependencies or connect to production.

## Runtime dependency boundary

`scripts/qa-stocks-package-builder.cjs` walks actual JavaScript syntax with the existing TypeScript AST parser. Starting from `services/stocks-global/server.mjs` and `local-proxy.mjs`, it follows imports/reexports and the literal SQLite `Worker(new URL(..., import.meta.url))` target. Bare npm imports, unresolved dynamic imports, nonliteral worker targets and paths outside the two reviewed Stocks runtime areas fail closed. The parser is a producer tool, not a runtime dependency.

The current closure uses Node built-ins plus relative Stocks modules, including `services/stocks-simulator/engine.mjs`. Its manifest records every source byte hash, edge, builtin, parser version and the observed Node executable version/hash/platform. It copies no `node_modules`. This is content-reproducible for the recorded source and Node binary, not a claim that another Node binary or container base has been validated.

`sha256` is the raw working-copy/copied-file byte hash. `canonicalLfSha256` is a separate UTF-8 CRLF-to-LF content hash for comparison with Git's canonical content. Windows CRLF differences must not be reported as runtime logic differences; conversely, canonical equivalence does not substitute for validating the exact bytes executed in the temporary package.

`services/stocks/Dockerfile` packages the separate reader and starts `runtime.mjs`. It remains unchanged and must not be presented as packaging for this authenticated simulator. A future Stocks-global image still needs a verified immutable base digest and explicit isolated storage/user/entrypoint/health/shutdown configuration. No digest is invented here.

## External execution proof

The proof runner creates a fresh private directory under the operating system temporary directory, outside the checkout. It copies the hash-verified runtime artifact there and starts a separate Node process with:

- that external directory as its working directory;
- `--no-global-search-paths`;
- no `NODE_PATH`, `NODE_OPTIONS`, production DB URL, JWT signing secret or inherited preload arguments;
- a QA driver whose hash is recorded separately from the runtime package.

The child independently verifies all runtime hashes and Node binary/version. Resolution of `express`, `jsonwebtoken` and `typescript` must fail. The actual runtime imports and its SQLite worker execute from the copy. The QA driver injects private, explicitly artificial fixture quotes; it is not a live market-data adapter or a production entrypoint. Its network guard admits only exact literal loopback listener ports and the fixed fixture `/me` authority; an external probe must fail before transport.

## Separate authority and storage proof

The earlier TLS r3 compiled `/me` artifact is reused only after all package bytes match their manifest and current reviewed source/dist bytes. It is copied into another fresh temporary package and started as the existing strict Prisma/session/policy fixture. That authority uses existing workspace dependencies through its own explicit `NODE_PATH`; it is **not** part of the standalone Stocks runtime. Its signing fixture and SQLite data remain separate. No backend rebuild, guessed dependency copy or npm install is needed for reuse.

The finite HTTP proof covers owner/viewer identity, a fractional buy, Wallet projection, viewer denial, transport loss only after a committed successful order response, worker restart and same-ID retry, cached-client feature-off admission, and quiesced byte-exact SQLite backup to a different path. Restore must preserve owner/viewer separation, amounts and idempotency. Original fixture data stays untouched. Integrity checks run only on closed fixture databases; durability settings and transaction rules are unchanged. This does not certify rollback to a historical binary/schema.

Both owned child processes have bounded IPC/exit waits and owned-process termination fallback. Closed fixture ledgers, source manifests, safe HTTP results and logs are retained outside Git. The external temporary copy is retained for independent inspection rather than silently deleted.

Post-restore replay is not byte-identical to the backup: the existing same-ID operation advances the owner's revision from 3 to 4 while the viewer remains at revision 0. The final proof compares **every ledger field except revision**, including wallets, reservations, orders, fills, positions, quotes, realized P&L, adjustments and settings, and separately asserts that exact revision delta. The retained original database hash must remain unchanged. Report r5 has 57 assertions; prior byte hashes and reports remain preserved and are not re-labelled as post-replay byte equality.

Invocation: `node scripts/qa-stocks-package-proof.cjs --output <new-absolute-directory> --authority-package <verified-r3-local-stage-package>`.

Closure regressions: `node --test scripts/qa-stocks-package-builder.test.cjs`.

The actual HTTP catalogue is also checked for the exact AAPLX identity, source symbol, asset, Bybit provider, USDT currency and company name. Independent review found that the initial QA adapter looked up `instrumentId` instead of the catalogue's `id` field. The before-fix HTTP regression is retained in `package-proof-catalogue-before`; earlier 54-assertion reports do not establish catalogue correctness. This was corrected only in the QA adapter, with an explicit required-instrument assertion.

No capacity, Linux/Node22, production auth throughput, production filesystem permissions, public ingress, UI, commercial data rights, MOEX, live market-data or deployment readiness follows from this packaging proof.
