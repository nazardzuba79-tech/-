# VOLTEX dependency security audit

Date: **2026-09-06**. Audited production source: **`e8bf772bd493bfe490bf2c2d131c09180b856d08`**, `Promote reviewed Titanium and Black Signature Card selectively to production`.

Branch: **`codex/security-dependency-audit`**, isolated from freshly fetched `origin/main`. Main matched the owner's exact required SHA before work began. This report records findings and proposed remediation, **not implemented fixes**.

## Executive assessment

- **Render reproduced exactly:** backend/root full and production-only audits each report **4 moderate / 3 high / 1 critical**, eight vulnerable package nodes.
- Frontend full audit: **6 moderate / 1 high / 0 critical**. Frontend production-only: **2 moderate / 0 high / 0 critical**.
- **Confirmed production-code reachable critical: NO. Confirmed production-code reachable high: 0.** One high Nodemailer advisory retains **F / CANNOT CONFIRM** for uninspected legacy/configuration address input. These statements are not a clean bill of health or an assertion that every high is proven unreachable.
- **Most important demonstrated runtime issue:** `react-router@6.30.6`, [GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), **moderate**. VOLTEX's `next` guard accepts a slash-backslash destination; actual installed BrowserRouter navigation attempts an external redirect after the normal login flow. An isolated browser test confirmed the navigation with every outgoing request blocked. No production exploit/login test occurred, and no auth bypass or token disclosure is claimed.
- **The critical warning is `tar@6.2.1`, not a demonstrated bcrypt password flaw.** It enters through `bcrypt -> node-pre-gyp`, remains production-installed, and extracts native binaries during dependency installation. No application archive-extraction route/import was found; a benign bcrypt module-load probe did not load tar. Build/install supply-chain exposure remains relevant.
- **Safe remediation availability: PARTIAL.** Published patched candidates exist, but several require major upgrades or explicitly tested overrides. No currently supported Capacitor/xcode parent upgrade was found that removes its vulnerable uuid chain. None of the proposed replacements was installed or compatibility-certified in this audit.
- Production dependency files, application code, financial histories, Auth behavior, database, migrations, Render configuration and production deployments were **not changed**. Only this report and the required handoff documentation are committed.

## 1. Reproduction and evidence

### Clean trees and commands

Both dependency trees were installed from the exact committed locks in the fresh isolated worktree using **`npm ci`**, with normal lifecycle scripts, independently:

```text
# root/backend
npm ci
npm audit --json
npm audit --omit=dev --json
npm ls --all --json

# frontend
cd frontend
npm ci
npm audit --json
npm audit --omit=dev --json
npm ls --all --json
```

Local audit runtime: Windows, Node **24.19.0**, npm **10.9.9**, registry `https://registry.npmjs.org/`. JSON collection time: **2026-09-06T15:15:02.632Z**. Backend clean install added 544 packages; frontend added 239. Both installs and both dependency-tree listings exited **0**. All four audits returned valid JSON with exit **1 because vulnerabilities were found**, not because the audit failed. No `npm audit fix`, lock refresh, package override or target upgrade was executed.

| Tree / mode | Moderate | High | Critical | Vulnerable package nodes |
| --- | ---: | ---: | ---: | ---: |
| Backend full | 4 | 3 | 1 | 8 |
| Backend `--omit=dev` | 4 | 3 | 1 | 8 |
| Frontend full | 6 | 1 | 0 | 7 |
| Frontend `--omit=dev` | 2 | 0 | 0 | 2 |

Backend has **23 distinct leaf advisories** (tar 12, Nodemailer 8, qs 2, uuid 1); frontend has **7** (Vite 3, esbuild 1, React Router 2, uuid 1). There are **29 unique GHSAs across both trees**, because uuid's advisory appears in both. Ancestor/metavulnerability entries are not new independent CVEs. The low Nodemailer advisory is included below for completeness within its high aggregate; it does not create a top-level low count.

### Render reconciliation

Read-only existing `exchange-api` build logs, service `srv-da467nn40ujc73cumjqg`, show the exact **8 vulnerabilities (4 moderate, 3 high, 1 critical)** at **2026-09-06T14:54:13.580711346Z** and **14:54:15.324367406Z**, in runtime-image `npm ci --omit=dev` and builder installation respectively. Thus the owner's warning is reproduced, including the production-only graph.

The checked-in backend [Dockerfile](../Dockerfile) uses Node 20 Alpine for builder and final runtime, with `npm ci` at line 9 and `npm ci --omit=dev` at line 29. Local Node/OS differs, and optional/platform package totals can differ, but the locked vulnerable nodes and 4/3/1 counts match exactly. Deprecation warnings for tar/glob are not additional advisories; glob is not a vulnerable node in this snapshot. No Render setting, service or deployment was changed.

### Retained audit artifacts

Local, outside Git: `outputs/security-dependency-audit/` in the containing Codex workspace (two levels above this worktree). It contains clean-install logs, all four audit JSONs, both `npm ls` JSONs, `collection.json`, `inventory.json`, primary advisory/version metadata, source-reachability notes, the isolated browser reproduction script/result, test log and build logs. These contain no production database export or credentials. The report below is self-contained; the artifacts preserve reproducibility details.

Original SHA-256 checksums, rechecked unchanged at completion:

| Committed file | SHA-256 |
| --- | --- |
| `package.json` | `f76d8ae1e910dcad1e1d448346f884af7779dddfba2b098e100a25ff1d50d43a` |
| `package-lock.json` | `df6ad33ea7c66fe7da45a0ed7012fe48a9ff28165d5b361ae076cfcc5f139011` |
| `frontend/package.json` | `c6ef76f5bd723f0f955e9946463a89add5553fb8797d190b196bf3f9cb3d55a7` |
| `frontend/package-lock.json` | `ee8d170c6239bca058fa5bcdbc694813c01078c6665ec518aa2bfe62a5589435` |

## 2. Classification and complete dependency paths

**A** directly runtime reachable; **B** indirectly runtime reachable; **C** installed in production but the vulnerable path is unused in examined code; **D** dev/build only; **E** not applicable to the configuration; **F** cannot confirm. An imported library or exposed benign function alone does not prove exploitation. Conversely, C does not erase package severity or install-time risk.

Versioned paths below come from `npm ls --all --json` and the actual locks. `B` means backend root and `F` frontend root here, not reachability classes. References to a path include its complete chain, not just its last edge:

```text
B1  backend -> bcrypt@5.1.1
B2  backend -> bcrypt@5.1.1 -> @mapbox/node-pre-gyp@1.0.11
B3  backend -> bcrypt@5.1.1 -> @mapbox/node-pre-gyp@1.0.11 -> tar@6.2.1
B4  backend -> nodemailer@6.10.1
B5  backend -> express@4.22.2
B6  backend -> express@4.22.2 -> body-parser@1.20.6
B7  backend -> express@4.22.2 -> qs@6.15.3
B8  backend -> express@4.22.2 -> body-parser@1.20.6 -> qs@6.15.3
B9  backend -> uuid@9.0.1
B10 backend -> supertest@7.2.2 -> superagent@10.3.0 -> qs@6.15.3 (dev consumer)
B11 backend -> express-rate-limit@7.5.1 -> express@4.22.2 (same deduplicated peer)
    B11's Express exposes the same B6/B7/B8 children; no second physical copy.

F1  frontend -> react-router-dom@6.30.6
F2  frontend -> react-router-dom@6.30.6 -> react-router@6.30.6
    -> @remix-run/router@1.23.4 (navigation implementation; no separate audit row)
F3  frontend -> vite@5.4.21
F4  frontend -> vite@5.4.21 -> esbuild@0.21.5
F5  frontend -> @vitejs/plugin-react@4.7.0 -> vite@5.4.21 (same deduplicated peer)
    F5 also exposes the same esbuild@0.21.5, not a second installation.
F6  frontend -> @capacitor/cli@8.5.0
F7  frontend -> @capacitor/cli@8.5.0 -> xcode@3.0.1
F8  frontend -> @capacitor/cli@8.5.0 -> xcode@3.0.1 -> uuid@7.0.3
```

## 3. Required package-level findings table

Ranges are npm aggregate/metavulnerability ranges for the installed major line; the next section gives each actual GHSA, CVE, exact affected interval and first patch. T/N/Q/U/R/V/E identifiers refer to those records. **YES** in Safe Fix means a published targeted fix exists subject to separate compatibility testing, not that an upgrade was performed. **PARTIAL** indicates unsupported parent-range override, wider migration or no clean parent release.

| Severity | Package | Installed | Vulnerable Range | Advisory | Dependency Path | Prod/Dev | Reachability | Safe Fix | Target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Critical | tar | 6.2.1 | `<=7.5.20` aggregate | T1–T12, critical T9 | B3, transitive | Prod; installer also runs at image build | C; T6 E | YES via parent replacement; direct tar override PARTIAL | bcrypt 6.0.0 removes chain; tar 7.5.21 alternative requires major override |
| High | bcrypt | 5.1.1 | `5.0.1 - 5.1.1` | Inherited node-pre-gyp/tar, no independent GHSA | B1, direct | Prod | C for reported archive flaws; hash/compare actually used | YES, major | 6.0.0 |
| High | @mapbox/node-pre-gyp | 1.0.11 | `<=1.0.11` | Inherited tar T1–T12 | B2, transitive | Prod | C; installer archive operations separate | YES via parent | Remove with bcrypt 6.0.0 |
| High | nodemailer | 6.10.1 | `<=9.0.0` aggregate | N1–N8 | B4, direct | Prod | F conservatively for N7 legacy/config; C current validated N7 flow and other modes | YES, major | 9.0.1 minimum for all eight |
| Moderate | express | 4.22.2 | `4.22.2` aggregate | Inherited body-parser/qs Q1–Q2 | B5/B11, direct + peer | Prod | C for reported qs modes | PARTIAL | Retain 4.22.2; narrowly test qs 6.16.0 override or await 4.x parent fix |
| Moderate | body-parser | 1.20.6 | `1.20.5 - 1.20.6` | Inherited qs Q1–Q2 | B6, transitive | Prod | C | PARTIAL | Retain 1.20.6 with explicitly tested qs 6.16.0 override |
| Moderate | qs | 6.15.3 | `2.2.5 - 6.15.3` aggregate | Q1–Q2 | B7/B8/B10 (+ B11 peer expansion), transitive | Prod + dev consumer | C | PARTIAL at parent constraints | 6.16.0, minor outside parents' tilde ranges |
| Moderate | uuid (backend) | 9.0.1 | `<11.1.1` | U1 | B9, direct | Prod | C, only v4 without output buffers | YES, major | 11.1.1, CommonJS-compatible |
| High | vite | 5.4.21 | `<=6.4.2` aggregate for this line | V1–V3 plus inherited E1 | F3/F5, direct + peer | Dev/build | D | YES, major | 6.4.3 minimum coherent parent candidate |
| Moderate | esbuild | 0.21.5 | `<=0.24.2` | E1 | F4/F5 expansion, transitive | Dev/build | D; serve API unused | YES via parent | >=0.25.0 through Vite 6.4.3 |
| Moderate | react-router-dom | 6.30.6 | `6.0.0-alpha.0 - 7.17.0` aggregate | Inherited R1–R2 | F1, direct | Prod browser bundle | A R1; E R2 | PARTIAL: library fix + app guard | 7.18.3 candidate; 7.18.0 minimum |
| Moderate | react-router | 6.30.6 | `6.0.0 - 7.17.0` aggregate | R1–R2 | F2, transitive | Prod browser bundle | A R1; E R2 | PARTIAL as above | 7.18.3 through Router DOM |
| Moderate | @capacitor/cli | 8.5.0 | `8.5.0 - 8.5.2-nightly-20260904T151235.0` in snapshot | Inherited xcode/uuid U1 | F6, direct | Dev/native tooling | D | PARTIAL | No clean current parent upgrade; evaluate scoped uuid 11.1.1 override |
| Moderate | xcode | 3.0.1 | `>=0.9.2` in snapshot | Inherited uuid U1 | F7, transitive | Dev/native tooling | D; affected uuid methods unused | PARTIAL | Await upstream or scoped uuid 11.1.1 override |
| Moderate | uuid (frontend tooling) | 7.0.3 | `<11.1.1` | U1 | F8, transitive | Dev/native tooling | D; caller uses v4 only | PARTIAL within xcode | 11.1.1, major outside xcode range |

## 4. Advisory-level inventory and runtime assessment

All high/critical records were checked against publisher/GitHub Reviewed advisories. Backend's 23 records were also retrieved through GitHub's public advisory API. Ranges below preserve advisory metadata, including differing fixed lines. No CVE was invented where none was assigned. Severity remains the advisory severity, not a downgrade from reachability: tar T9 is critical (publisher CVSS4 9.2, npm also embeds CVSS3 7.5); uuid U1 is moderate despite its embedded CVSS3 7.5.

### 4.1 tar — every high/critical issue and its installer boundary

All T records apply to **installed tar 6.2.1**, transitive **B3**, production-installed. Each row has a distinct prerequisite; the common source evidence following the table establishes why archive inputs are not application-runtime inputs.

| ID / severity | Advisory / CVE | Affected | First fixed | Prerequisite and VOLTEX classification |
| --- | --- | --- | --- | --- |
| T1 High | [GHSA-34x7-hfp2-rc4v](https://github.com/isaacs/node-tar/security/advisories/GHSA-34x7-hfp2-rc4v), CVE-2026-24842 | `<7.5.7` | 7.5.7 | Relative hardlink target escapes extraction root. **C**: malicious installer archive, not HTTP upload, would be needed. |
| T2 High | [GHSA-8qq5-rm4j-mr97](https://github.com/isaacs/node-tar/security/advisories/GHSA-8qq5-rm4j-mr97), CVE-2026-23745 | `<=7.5.2` | 7.5.3 | Crafted hardlink/symlink targets bypass extraction sanitization. **C**, extraction only during installation. |
| T3 High | [GHSA-83g3-92jg-28cx](https://github.com/isaacs/node-tar/security/advisories/GHSA-83g3-92jg-28cx), CVE-2026-26960 | `<7.5.8` | 7.5.8 | Symlink plus hardlink chain escapes output directory. **C**, same archive trust boundary. |
| T4 High | [GHSA-qffp-2rhf-9h96](https://github.com/isaacs/node-tar/security/advisories/GHSA-qffp-2rhf-9h96), CVE-2026-29786 | `<=7.5.9` | 7.5.10 | Drive-relative hardlink validation mismatch. **C**; vendor reproduces on Linux, so this is NOT dismissed as Windows-only. |
| T5 High | [GHSA-9ppj-qmqm-q256](https://github.com/isaacs/node-tar/security/advisories/GHSA-9ppj-qmqm-q256), CVE-2026-31802 | `<=7.5.10` | 7.5.11 | Drive-relative symlink changes after validation. **C**; also not Windows-only. |
| T6 High | [GHSA-r6q2-hw4h-h46w](https://github.com/isaacs/node-tar/security/advisories/GHSA-r6q2-hw4h-h46w), CVE-2026-23950 | `<=7.5.3` | 7.5.4 | Concurrent extraction with Unicode-colliding case/normalization-insensitive paths; demonstrated on macOS APFS. **E** for declared production Linux Alpine filesystem configuration, not a dismissal of other tar issues. |
| T7 Moderate | [GHSA-vmf3-w455-68vh](https://github.com/isaacs/node-tar/security/advisories/GHSA-vmf3-w455-68vh), CVE-2026-53655 | `<=7.5.15` | 7.5.16 | PAX/GNU parser differences permit file smuggling across scanners/extractors. **C**, no runtime archive parsing. |
| T8 Moderate | [GHSA-w8wr-v893-vjvp](https://github.com/isaacs/node-tar/security/advisories/GHSA-w8wr-v893-vjvp), CVE-2026-59871 | `<=7.5.17` | 7.5.18 | Numeric PAX path causes uncaught type error. **C**, malicious extraction input needed. |
| T9 Critical | [GHSA-23hp-3jrh-7fpw](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw), CVE-2026-59873 | `<=7.5.18` | 7.5.19 | Unbounded compressed archive expansion exhausts resources. **C**, build/install exposure, no current remote API-to-tar sink. Not confirmed production API DoS. |
| T10 High | [GHSA-8x88-c5mf-7j5w](https://github.com/isaacs/node-tar/security/advisories/GHSA-8x88-c5mf-7j5w), CVE-2026-59874 | `<=7.5.17` | 7.5.18 | Replacing an existing archive with negative entry size loops. **C**: neither application nor ordinary installer calls `tar.replace`. |
| T11 Moderate | [GHSA-gvwx-54wh-qm9j](https://github.com/isaacs/node-tar/security/advisories/GHSA-gvwx-54wh-qm9j), CVE-2026-59875 | `<=7.5.16` | 7.5.17 | NUL in PAX path/linkpath causes uncaught filesystem error. **C**, archive input absent at runtime. |
| T12 High | [GHSA-r292-9mhp-454m](https://github.com/isaacs/node-tar/security/advisories/GHSA-r292-9mhp-454m), CVE-2026-73566 | `<=7.5.20` | 7.5.21 | Deep path recursion requires list/extract with a nonempty member-selection list. **C**: ordinary node-pre-gyp extraction supplies no member-selection list; app has no archive operations. |

Installed `bcrypt/package.json:29` runs `node-pre-gyp install --fallback-to-build`. Its configured HTTPS GitHub native-binary archive enters `@mapbox/node-pre-gyp/lib/install.js:64,78,100`, calling `tar.extract({cwd, strip:1, onentry})`. It runs in both Docker dependency-install stages. A compromised accepted archive can therefore attack the installer; no claim of supply-chain immunity is made.

At application startup `bcrypt/bcrypt.js:3,5` invokes node-pre-gyp's lazy `find()` (`lib/pre-binding.js:17`) to locate a preinstalled binding. This does not execute the installer. A bounded local `require('bcrypt')` diagnostic confirmed `hash` exists, **tarLoaded=false**, **preGypInstallLoaded=false**. Non-test application source contains no tar import/extraction/replace/list call. KYC saves individual documents rather than unpacking archives.

Real password/backup-code operations are at `src/api/routes/auth.ts:181,229`, `account.ts:157,160`, `src/services/TwoFactorService.ts:35,55`. The high **bcrypt** and **node-pre-gyp** rows are inherited archive findings, not independent hashing GHSAs, broken password verification or proven command injection.

**Remediation:** individually, each T row has the first patch listed; to avoid *all* these tar advisories requires **7.5.21**, not just critical fix 7.5.19. Prefer removing the obsolete chain through **bcrypt 6.0.0**. Forcing tar 7 into node-pre-gyp's `^6.1.11` is an untested major override, not a safe lock-only patch. Priority **P3**, with explicit build/supply-chain risk.

### 4.2 Nodemailer — both high issues and all remaining advisories

All N records apply to **nodemailer 6.10.1**, direct **B4**, production. Only `src/services/SupportEmailService.ts` and `KycEmailService.ts` construct/send mail.

| ID / severity | Advisory / CVE | Affected | First fixed | Prerequisite and VOLTEX classification |
| --- | --- | --- | --- | --- |
| N1 Moderate | [GHSA-mm7p-fcc7-pg87](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-mm7p-fcc7-pg87), CVE-2025-13033 | `<7.0.7` | 7.0.7 | Quoted local-part with embedded @ may route to unintended domain. **C** for current validated input; legacy/config address values uninspected. |
| N2 Low | [GHSA-c7w3-x93f-qmm8](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-c7w3-x93f-qmm8), no assigned CVE in retrieved metadata | `<8.0.4` | 8.0.4 | CRLF in `envelope.size`. **C**: neither call sets envelope/size. Included to fully explain high aggregate. |
| N3 Moderate | [GHSA-vvjj-xcjg-gr5g](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-vvjj-xcjg-gr5g), no assigned CVE | `<=8.0.4` | 8.0.5 | CRLF in transport EHLO/HELO name. **C**: constructors omit custom `name`. |
| N4 Moderate | [GHSA-268h-hp4c-crq3](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-268h-hp4c-crq3), no assigned CVE | `<=8.0.8` | 8.0.9 | CRLF through List-* comment. **C**: no list/comment/header option. |
| N5 Moderate | [GHSA-wqvq-jvpq-h66f](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-wqvq-jvpq-h66f), no assigned CVE | `<=8.0.8` | 8.0.9 | Content normalization bypasses file/URL restrictions in JSON transport / attachDataUrls. **C**: fixed SMTP options, neither feature nor arbitrary content object used. |
| N6 Moderate | [GHSA-r7g4-qg5f-qqm2](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-r7g4-qg5f-qqm2), no assigned CVE | `<=8.0.7` | 8.0.8 | OAuth2 token HTTPS fetch accepts invalid TLS. **C**: both constructors use explicit username/password, not OAuth2. |
| N7 High | [GHSA-rcmh-qjqh-p98v](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-rcmh-qjqh-p98v), CVE-2025-14874 | `>=3.0.0 <=7.0.10` | 7.0.11 | Deeply nested RFC5322 address groups recurse. **F overall** for uninspected old/config addresses; **C for current request-validation path**. See detailed flow below. |
| N8 High | [GHSA-p6gq-j5cr-w38f](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-p6gq-j5cr-w38f), CVE-2026-82659 | `<=9.0.0` | 9.0.1 | Message-level `raw.path/raw.href` bypasses denial flags, allowing file read/SSRF. **C**: no message-level raw option/passthrough exists. SMTP alone is not a defense; this issue affects all transports when raw is supplied. |

**N7 runtime evidence and unresolved scope.** Support's public optional-auth create route (`src/api/routes/support.ts:59`) validates `email` with `z.string().email()` at line 27 before persisting it at line 69 and passing it to the notification. Installed Zod 3.25.76's email regex (`node_modules/zod/v3/types.cjs:393,560`) rejects nested-group grammar. A harmless local validation probe accepted an ordinary address and rejected groups, comments, CRLF and a quoted local-part containing @. No deep recursion payload or SMTP request was sent.

`SupportEmailService.ts:48` builds host/port/secure/user/pass options, and `:83-89` constructs only from/to/replyTo/subject/text. Configured inbound address or validated guest email becomes replyTo; body/name are plain text, not arbitrary address headers. Nodemailer's vulnerable group recursion is `lib/addressparser/index.js:71`. However later messages reuse persisted `conversation.guestEmail` (`support.ts:137`) without revalidation; configured from/to/inbound addresses also enter the parser. This audit intentionally did **not** read production stored values or environment secrets, so **production-wide non-reachability cannot be certified**. N7 remains **P2 / F**, not a confirmed live high exploit.

**N8 source defense.** `KycEmailService.ts:47,87-97` builds SMTP and a whitelist message with one server-generated local attachment path. `src/api/routes/kyc.ts:29,101,112` supplies that path from Multer handling. An intentional uploaded-document attachment is not `raw` root-node access, arbitrary URL fetching or user-controlled filesystem traversal. Neither email class spreads request objects into `sendMail`. No `raw`, `jsonTransport`, `attachDataUrls`, OAuth2, envelope size, custom EHLO name or List-* construction was found. SMTP might be enabled or disabled in production; disabling was not assumed as a defense.

**Remediation:** individual first patches are not an all-advisory fix. **9.0.1** is the minimum Nodemailer version outside all eight affected intervals. It is a major jump from 6.10.1, requiring separate mail composition, attachment, error and type compatibility tests. npm's 10.0.0 suggestion is wider than necessary. N7 P2; explicit unused N2–N6/N8 modes are P3-category follow-up (direct production package, rather than literally transitive).

### 4.3 HTTP parsing and UUID advisories

| ID / severity | Package and path | Advisory / CVE | Affected / first fixed | Reachability |
| --- | --- | --- | --- | --- |
| Q1 Moderate | qs 6.15.3, B7/B8/B10 | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), CVE-2026-82562 | `>=6.14.2 <=6.15.3`; **6.16.0** | **C**: array-limit bypass requires `comma:true`; current Express leaves false. |
| Q2 Moderate | qs 6.15.3, same chains | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), CVE-2026-82417 | `>=2.2.5 <6.16.0`; **6.16.0** | **C**: attacker-controlled `constructor.isBuffer` reaches vulnerable `qs.stringify`; app invokes parse only, not parse-to-stringify. |
| U1 Moderate | uuid 9.0.1 B9; uuid 7.0.3 F8 | [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq), CVE-2026-41907 | `<11.1.1`, `>=12 <12.0.1`, `>=13 <13.0.1`; **11.1.1 / 12.0.1 / 13.0.1** | **C backend / D frontend tooling**: v3/v5/v6 caller-buffer/offset issue; actual callers use no-argument v4. |

Express is actually internet-input reachable. `src/index.ts:61,122,132,133,137` creates it, configures trust proxy, JSON body limits and the limiter. Its default extended query middleware runs before application auth/limiting, so those are **not** universal parser defenses. `express/lib/utils.js:288` calls `qs.parse(str,{allowPrototypes:true,arrayLimit:1000})`; `qs/lib/parse.js:16` defaults comma to false. The isBuffer helper's only qs caller is `stringify.js:127`. Non-test source has no custom qs parser/stringifier or `express.urlencoded()` workflow. Findings on Express/body-parser are propagation of Q1/Q2, not separate established HTTP vulnerabilities.

Actual UUID use: `src/matching-engine/MatchingEngine.ts:1,62`, `src/services/OrderService.ts:5,101,195-197`, `DemoTradingService.ts:3,81`, `src/futures/FuturesPositionService.ts:3,129` all select `v4` and supply no buffer/offset. No demonstrated order ID truncation exists from U1. Frontend native tooling `xcode/lib/pbxProject.js:22,89-90` similarly uses `uuid.v4()`, not an affected method.

### 4.4 Frontend production-only risks

[frontend/Dockerfile](../frontend/Dockerfile) installs/builds under Node 20 Alpine, then copies only `dist` and nginx configuration into **nginx:alpine**. React Router runs in the browser bundle; Vite/esbuild/Capacitor CLI do not run in that final image. This is committed deployment-recipe evidence, not a new remote container inspection.

| ID / severity | Advisory / CVE | Installed / path | Affected / first fixed | Assessment |
| --- | --- | --- | --- | --- |
| R1 Moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), CVE-2026-53669 | react-router 6.30.6, F1/F2 | `>=6 <7.18.0`; **7.18.0** | **A**, current URL-controlled post-login navigation reaches slash-backslash external redirect. |
| R2 Moderate | [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), CVE-2026-53666 | same | `>=6.4 <7.18.0`; **7.18.0** | **E**: SSR error-metadata constructor injection requires hydration; this app uses declarative BrowserRouter/createRoot, no SSR. |

**R1 exact source and isolated proof:**

- `frontend/src/lib/returnTo.ts:14-15` accepts a leading `/` unless it begins `//`; it does not reject a following backslash. `readNext` at 25-27 decodes the public query parameter then applies that guard.
- `frontend/src/pages/AuthPage.tsx:35,47,64` passes accepted destination to `navigate()` after successful normal or 2FA login, using push semantics.
- Installed `@remix-run/router/dist/router.cjs.js:468-489` falls back from a failed `history.pushState` to `window.location.assign`. Browser URL normalization converts the slash-backslash authority prefix into an external destination.
- The same input reaches `RegisterPanel.tsx:162` / `App.tsx:44` with replace semantics. The isolated test produced a History SecurityError there, **not** a demonstrated successful external redirect.
- Existing `returnTo.test.ts:38-46` tests ordinary absolute/protocol-relative paths but omits the mixed-slash case. All existing tests passing does not refute this finding.

Reproduction used exact unmodified `returnTo.ts` compiled in memory and actual installed React/React Router UMD modules in headless Edge. Four assertions passed: ordinary internal path stays internal; protocol-relative path is rejected; mixed slash/backslash push attempts external navigation; mixed slash/backslash replace throws. All URLs were intercepted on an isolated `.invalid` origin; outbound navigation was blocked. No user credentials, real account, token, API, production request or database was used. Impact demonstrated: unwanted external redirection/phishing opportunity and replace-path failure, **not account takeover or auth bypass**.

**R2:** `frontend/src/main.tsx:10` uses createRoot and `App.tsx:1,49` BrowserRouter/Routes. No product `hydrateRoot`, RouterProvider/data router, SSR entry, hydration error state or deserializeErrors use was found. React server rendering occurs only in static-markup tests. No SSR-specific mitigation is needed for this production configuration; upgrading the same Router dependency resolves the version finding.

### 4.5 Frontend high and development/build-only issues

| ID / severity | Advisory / CVE | Installed / path | Affected / first fixed | Assessment |
| --- | --- | --- | --- | --- |
| V1 High | [GHSA-fx2h-pf6j-xcff](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff), CVE-2026-53571 | Vite 5.4.21, F3/F5 | `<=6.4.2`, `>=7 <7.3.5`, `>=8 <8.0.16`; **6.4.3 / 7.3.5 / 8.0.16** | **D**: Windows path variants bypass dev-server fs.deny. No Vite dev middleware in final nginx. |
| V2 Moderate | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), CVE-2026-39365 | same | `<=6.4.1`, `>=7 <7.3.2`, `>=8 <8.0.5`; **6.4.2 / 7.3.2 / 8.0.5** | **D**: reachable optimized-dependency middleware plus predictable sensitive valid source-map files required. |
| V3 Moderate | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), CVE-2026-53632 | same; bundled editor helper | Vite `<=6.4.2`, `>=7 <7.3.5`, `>=8 <8.0.16`; **6.4.3 / 7.3.5 / 8.0.16**. launch-editor `<=2.14.0`, fixed **2.14.1** | **D**: Windows editor middleware handling UNC paths with NTLM enabled; no such production middleware. |
| E1 Moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), no CVE listed | esbuild 0.21.5, F4/F5 expansion | `<=0.24.2`; **0.25.0** | **D**: esbuild serve API's permissive CORS. Current workflow uses build/transform, not esbuild serve. |

**V1 detailed high assessment.** The vulnerable Windows dev HTTP handler can expose denied files using alternate/NTFS/8.3 path forms when the dev server and files are reachable. This workstation is Windows, so developer risk is real under those prerequisites. Checked-in `frontend/vite.config.ts:1-11` and package scripts do not set `--host` or a permissive network host. A manually shared server, tunnel or config override was not ruled out; no malicious file/credential probe was run. The high severity is retained. The production recipe does not launch Vite, making this **P4 / D**, not production arbitrary-file read.

V3 can involve a cross-site request to local editor middleware, so localhost alone is not claimed as a universal NTLM defense. There is no separately installed launch-editor node in this frontend lock; overriding a standalone package would not necessarily fix bundled Vite code. E1 affects esbuild's serve API, not every bundle built with esbuild. Vite's own HTTP server is not automatically esbuild serve.

Capacitor CLI 8.5.0 / xcode 3.0.1 / uuid 7.0.3 add three moderate package rows for **U1**, not three new advisories. The chain is used by CLI UIScene migration (`@capacitor/cli/dist/util/xcode.js:5,17`, `tasks/migrate-uiscene.js:11,48`), not `tsc && vite build` or the web runtime; xcode calls unaffected v4. The runtime-declared Capacitor core/android packages are not flagged, and no app-source Capacitor import was found. Native application security is outside this web dependency audit.

## 5. Financial-system sensitive entry-point inventory

Every listed package was checked against the clean installed audit, not assumed vulnerable from its name. “Not flagged” means **no current npm finding in this snapshot**, not a full security certification.

| Area / installed dependency | Actual inspected use | Result / boundary |
| --- | --- | --- |
| bcrypt 5.1.1 | Registration/login/password change and 2FA backup-code hashing | High inherited installer chain; no independent bcrypt/hash GHSA from this audit. |
| jsonwebtoken 9.0.3 | JWT sign/verify in auth routes and `src/api/middleware/auth.ts` | Not flagged. Session/auth policy unchanged; no auth bypass inferred from router redirect. |
| multer 2.2.0, busboy 1.6.0 | Authenticated KYC single document upload; diskStorage, 8MiB bound, MIME allowlist (`kyc.ts:27-47,68`) | Not flagged; individual file write, not tar extraction. No path traversal invented. |
| Express 4.22.2 / body-parser 1.20.6 / qs 6.15.3 | Public HTTP query and bounded JSON parsing | Q1/Q2 modes unused as documented; no claim that all parsing is behind auth/rate limiting. |
| express-rate-limit 7.5.1, helmet 7.2.0, cors 2.8.6 | Middleware in main server | Not flagged; peer Express points to same vulnerable qs graph, not a rate-limiter GHSA. |
| Nodemailer 6.10.1 | Support/KYC SMTP services | N1–N8; raw SSRF unused, N7 legacy/config uncertainty explicit. No production email sent. |
| speakeasy 2.0.0, qrcode 1.5.4 | TOTP verify (`TwoFactorService.ts:17`) and QR encoding (`account.ts:248`) | Not flagged. No 2FA/config changes. |
| ethers 6.17.0, ws 8.21.0 | JsonRpcProvider chain reads in EvmDepositVerifier/ReservesService | Not flagged. No source WebSocketProvider/ws server entry found. Legacy WalletService xpub derivation exists but is not wired into active source routes; no active signing endpoint inferred. |
| @prisma/client 5.22.0, prisma 5.22.0 | Prisma client, generated types, startup migration workflow | Not flagged. No production DB access, migration, schema or data modification during audit. Optional peer/CLI installation is not assumed absent solely from dev classification. |
| bignumber.js 9.3.1 | Financial arithmetic | Not flagged; no arithmetic/rounding/ledger changes. |
| zod 3.25.76 | Request validation, including support email | Not flagged; validation grammar evaluated locally, not broadly assumed safe. |
| dotenv 16.6.1, winston 3.19.0 | Environment loading and logging | Not flagged; no environment values/production secrets inspected. |
| React 18.3.1 / React DOM 18.3.1, framer-motion 11.5.4, lightweight-charts 5.2.1 | Browser components/charts | Not flagged; no visuals or performance data changed. |

Prototype-shaped object crashes (Q2), SSR deserialization (R2), archive path traversal (T records), SMTP file/URL access (N8), parser/resource DoS (T9/N7/Q1/Q2), developer file disclosure (V records) and UUID buffer handling were assessed at their concrete sinks. No additional command execution, ReDoS, cryptographic weakness, database vulnerability or account compromise is asserted without advisory and source evidence. OS/nginx/Alpine image CVEs, native platform code, pentesting and unknown advisories outside npm are not covered by this audit.

## 6. Remediation order — proposal only

The owner's severity/reachability priority definitions are preserved. They do not explicitly categorize a **confirmed moderate runtime issue** or an unused **direct** production dependency; those cases are identified honestly rather than relabelled high.

| Priority | Findings | Recommended separate action |
| --- | --- | --- |
| P0 — confirmed exploitable critical production | **None confirmed** | No emergency production change justified solely by the critical package count. |
| P1 — confirmed reachable high/critical production | **None confirmed** | Do not inflate moderate R1 into high. |
| Confirmed moderate runtime — first actionable runtime remediation, outside P1's severity definition | **R1** | First fix normalized same-origin `next` validation with focused mixed-slash/control-character regressions; separately validate patched Router DOM migration. Do not assume a library upgrade enforces the app's destination policy. |
| P2 — production dependency with uncertain reachability | **N7** | Prefer tested Nodemailer 9.0.1 upgrade to remove parser and other reported defects. Any examination of old stored/config addresses requires a separate explicitly authorized plan; none performed here. |
| P3 — non-reachable production transitive | **T1–T12, bcrypt/node-pre-gyp aggregate; Q1/Q2, Express/body-parser aggregate** | Remove archive chain through tested bcrypt 6.0.0; then resolve qs 6.16.0 through a narrow reviewed override or upstream 4.x parent update. T6 needs no platform-specific app change. |
| P3-category hygiene — same non-reachability, but direct dependency rather than literal transitive | **U1 backend; explicit unused Nodemailer modes** | Test uuid 11.1.1 and retain deliberate mail option allowlists. Do not redesign IDs or mail flows. |
| P4 — dev/build only | **V1–V3/E1; U1 via CLI/xcode** | Validate Vite 6.4.3 before exposing dev middleware; keep native CLI issue separate pending parent fix/scoped override tests. |

The confirmed moderate redirect should not wait behind harmless-by-configuration package-count cleanup. This ordering proposes work; it does not authorize deploying any remediation in this task.

## 7. Exact upgrade candidates, compatibility risks and expected lock movement

All metadata below was read from official registry/vendor sources on the audit date. No target lock was generated, so transitive movements are **expected from published declarations**, not claimed exact resolved results. Every dependency change requires a lockfile change and re-audit in a separate branch.

| Current -> candidate | Delta / safe-fix status | Expected dependency movement | Code/API compatibility and required checks |
| --- | --- | --- | --- |
| bcrypt 5.1.1 -> **6.0.0** | Major; **YES candidate** | Replace node-pre-gyp/tar chain with node-gyp-build `^4.8.4`; node-addon-api `^5` -> `^8.3`; prune exclusive old transitives | Node >=18 supports declared Node20, but test actual Linux Alpine/musl native installation and old-hash compare, password change, backup codes, types. Existing hash/compare API expected usable; no source rewrite established as necessary. |
| tar 6.2.1 -> **7.5.21** alternative only | Major override; **PARTIAL**, violates node-pre-gyp `^6.1.11` | chownr2->3, yallist4->5, minipass5->7, minizlib2->3, fs-minipass replaced by @isaacs/fs-minipass4; possible mkdirp prune | CJS exists but extraction semantics/installer compatibility untested. Prefer bcrypt chain removal rather than forcing this override. |
| Nodemailer 6.10.1 -> **9.0.1** | Major across 7/8/9; **YES candidate** | No runtime transitives; package replacement, possibly declaration maintenance | Basic SMTP/CJS remains. Test plaintext/header composition, valid/rejected addresses, attachments, unavailable SMTP, generic errors and @types/nodemailer compatibility. No production send required. |
| uuid 9.0.1 -> **11.1.1** | Major; **YES candidate** | Zero runtime dependencies; bundled types may supersede @types/uuid9 | Retains CJS require, v4 string API; verify Node20/Jest, order identifiers, types and existing persisted ID behavior. Do not choose latest14 automatically. |
| qs 6.15.3 -> **6.16.0** under Express4/body-parser1 | Minor library, outside parent tilde; **PARTIAL** | Same side-channel `^1.1.1` / es-define-property `^1.0.1` declarations; explicit scoped root override and lock change needed unless parent publishes compatible update | Current Express4.22.2 and body-parser1.20.6 both require `~6.15.1`. Lock-only refresh cannot reach6.16.0. Test nested query compatibility and bounds. No application change proved necessary beyond chosen dependency override; unsupported range crossing still requires validation. |
| Router DOM / Router 6.30.6 -> **7.18.3** (minimum7.18.0) | Major; **PARTIAL** as complete R1 fix also needs app guard | Router7.18.3 adds cookie `^1.0.1` / set-cookie-parser `^2.6.0`; old @remix-run/router may prune | React>=18/Node>=20 match declared web builder. Test declarative routes, normal/2FA login, registration, guarded destinations/admin paths, F5 and all products. Keep BrowserRouter; no SSR conversion. |
| Vite 5.4.21 -> **6.4.3**; esbuild0.21.5 -> **>=0.25.0** via parent | Major Vite / pre-1.0 esbuild minor; **YES candidate** | Vite6 declares esbuild `^0.25.0`, Rollup `^4.34.9`, PostCSS `^8.5.3`, tinyglobby/fdir/picomatch; resolved lock must be checked | Existing plugin-react4.7.0 peers Vite6; Node20 fits. Verify CSS/scoped Card Tailwind, assets/charts, proxy, HMR and built routes. No code change established until migration tests. |
| Capacitor CLI8.5.0 / xcode3.0.1 -> upstream fix OR scoped xcode uuid7.0.3 -> **11.1.1** | No clean current parent fix; cross-major override **PARTIAL** | Change xcode's uuid node only, not unrelated global UUID consumers | xcode requests `^7.0.3`, so override crosses major constraints. Test CJS UUID generation, Xcode parse/write and native CLI fixtures/builds. No production-web app code change needed for unused native path. |

### Why not blindly accept npm's proposed versions

- [bcrypt v6 release](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0) and [6.0.0 metadata](https://registry.npmjs.org/bcrypt/6.0.0) confirm removal of node-pre-gyp. [tar 7.5.21 metadata](https://registry.npmjs.org/tar/7.5.21) confirms the alternative patch boundary, not compatibility with node-pre-gyp's older declared range.
- [Nodemailer 9.0.1](https://github.com/nodemailer/nodemailer/releases/tag/v9.0.1) fixes the last reported raw-access issue. [Registry9.0.1](https://registry.npmjs.org/nodemailer/9.0.1) retains CJS/no dependencies. [v7](https://github.com/nodemailer/nodemailer/releases/tag/v7.0.0) changes SES (unused), [v8](https://github.com/nodemailer/nodemailer/releases/tag/v8.0.0) changes NoAuth to ENOAUTH, and [v9](https://github.com/nodemailer/nodemailer/releases/tag/v9.0.0) tightens TLS/URL fetching. Do not disable certificate validation to make an upgrade pass. npm suggests10.0.0, whose [release](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0) introduces bundled TypeScript/dual builds; it is **not ESM-only**, but is broader than required.
- [uuid11.1.1 backport](https://github.com/uuidjs/uuid/releases/tag/v11.1.1) / [metadata](https://registry.npmjs.org/uuid/11.1.1) retain CommonJS. [uuid12](https://github.com/uuidjs/uuid/releases/tag/v12.0.0) removed CJS. npm's14.0.2 suggestion adds module-system risk to current backend CommonJS and xcode `require`; modern Node's ability to load some ESM does not prove cross-Node/Jest compatibility.
- [Express4.22.2](https://registry.npmjs.org/express/4.22.2) is still the latest4 tag on the audit date. [body-parser1.20.6](https://registry.npmjs.org/body-parser/1.20.6) also pins qs `~6.15.1`; no4.22.3/1.20.7 parent fix was available. [qs6.16.0](https://registry.npmjs.org/qs/6.16.0) is published, but needs a deliberately scoped override. Express5.2.1/body-parser2.3.0 allow a fixed qs resolution, yet introduce broad request/router/parser API changes; **do not migrate the exchange to Express5 just to clear the warning**.
- [Router DOM7.18.3](https://registry.npmjs.org/react-router-dom/7.18.3) pins [Router7.18.3](https://registry.npmjs.org/react-router/7.18.3); v6 tag remains6.30.6 without a patched backport. The app-specific destination guard still needs independent testing after upgrading.
- [Vite6.4.3 metadata](https://registry.npmjs.org/vite/6.4.3) and [5->6 migration guide](https://v6.vite.dev/guide/migration) support the narrower candidate.6.4.2 alone leaves V1/V3. npm's8.2.2 recommendation changes the bundler to Rolldown and exceeds existing plugin-react4.7.0's peer support; not a minimal fix. Forcing esbuild0.25 into Vite5's `^0.21.3` is also an unsupported range override.
- [CLI8.5.1](https://registry.npmjs.org/%40capacitor%2Fcli/8.5.1) still declares xcode3.0.1. npm's proposed [8.4.3](https://registry.npmjs.org/%40capacitor%2Fcli/8.4.3) removes xcode, but is a **downgrade outside `^8.5.0`**, despite `isSemVerMajor:true` wording. It reverses newly added [UIScene migration functionality](https://github.com/ionic-team/capacitor/releases/tag/8.5.0); do not blindly downgrade or globally override uuid. Existing CLI8 expects Node>=22 whereas web builder uses20: a separate native-tool engine-support issue, not an npm vulnerability or reason to alter production Docker here.

## 8. No-action items and limits

No additional application mitigation is indicated for R2 SSR deserialization because the product does not use SSR/hydration; do not add an SSR framework. No macOS-specific production patch is indicated for T6 on the declared Alpine deployment. No financial ID rewrite is warranted for U1 because every current call uses unaffected v4 without buffers. No SMTP feature-removal refactor is warranted for absent raw/JSON/OAuth/List/envelope options. No esbuild-serve or native CLI production workaround is warranted where those services are not deployed.

These are reasons to avoid unrelated source changes, **not permission to treat old vulnerable dependency versions as permanently safe**. Future feature/config changes can alter reachability. Keep targeted dependency hygiene in a separate remediation task. Known unknowns: actual SMTP enablement/addresses, imported/legacy support email contents, external native-archive integrity, configuration drift outside committed deployment recipes, OS/container/native-platform vulnerabilities and issues absent from npm advisory data. No production DB, secrets, balances or live attack probes were accessed for this audit.

## 9. Validation and preservation

Because documentation is committed, existing checks were run from this fresh exact-base worktree:

- Backend TypeScript `tsc --noEmit`: **PASS**; backend production `tsc`: **PASS**.
- Frontend TypeScript `tsc --noEmit` and build's `tsc -b`: **PASS**.
- Full configured Jest: **99 suites / 996 tests PASS** (backend and configured frontend tests). No tests were changed to accommodate findings.
- Frontend production build: **PASS**, Vite5.4.21,5634 modules. Existing >500kB chunk-size warning remains; not a security finding. Initial sandbox launch failed with esbuild `spawn EPERM`; rerunning the same build with child-process permission passed without source/dependency edits.
- Isolated actual-library navigation reproduction: **4 cases PASS**, outbound requests blocked; confirms R1 and replace-path failure. This is not a production pentest or a page redesign QA claim.
- Four manifest/lock SHA-256 values above remain identical. `git diff -- package.json package-lock.json frontend/package.json frontend/package-lock.json` and comparison against the production base have no dependency-file changes.
- Only `docs/SECURITY_DEPENDENCY_AUDIT.md` and `docs/AI_HANDOFF.md` change. Crypto Card, Copy Trading, Nazar/Ksenia histories, Trade, Wallet, Futures, Analytics, Arbitrage, Auth, money/market behavior, database/migrations, Render and production are untouched.

**Next recommended action, not executed:** authorize a separate tightly scoped remediation beginning with the confirmed `next` redirect guard and regression tests, then Nodemailer9.0.1 and tested Router7.18.3; follow with bcrypt6 chain removal, a reviewed qs6.16.0 override and uuid11.1.1. Handle Vite6.4.3 and native CLI dependency cleanup independently. Re-run full/omit-dev audits, Linux Node20 native install, tests/build and protected-route regressions. No broad upgrades, force fixes or production deployment should be inferred from this audit.
