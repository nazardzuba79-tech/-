# Native browser qualification for disposable GitHub CI

This source uses an ordinary `ubuntu-22.04` GitHub VM. It never changes AppArmor,
sysctls, seccomp, kernel policy, old Chrome permissions, system certificate trust,
or the Stocks runtime. No container profile from the held proposal is imported.

The official runner source deliberately makes `/opt` and `/usr/share` writable.
The new installation is therefore beneath `/usr/lib`, in the exact package-SHA
prefix in `manifest.json`. Every actual parent, file owner/mode and non-root
identity write denial is checked before Chrome's version command. Failure is a
failure; no path, sandbox, TLS or browser fallback is provided.

## Commands (not execution evidence)

On the reviewed exact Git SHA only, after ordinary distro dependency preparation:

```sh
sudo /usr/bin/env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C /usr/bin/python3 -I scripts/stocks-browser-native/provision.py --source-sha "$SHA" --run-id "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The root provisioner validates exact Git blob content (not clean status), uses
isolated system Python, authenticates the pinned Google key, InRelease, Packages
and Chrome .deb, checks installed dependency versions, and extracts only the
Chrome payload. No deb maintainer scripts run. Only newly extracted executable
modes are normalized; setuid/setgid bits are not installed. Namespace sandbox
qualification must succeed without them.

GPG key import and verification use two temporary homes in a fresh root-owned
0700 directory under `/run`. They cannot live beneath the long package-SHA
prefix: the previous import socket name was 131 bytes before its terminating
NUL, exceeding Linux's 108-byte Unix-socket field. The guard bounds all four
agent socket suffixes including NUL before invoking GPG. `--no-autostart` and
every nonzero-exit rejection remain unchanged; no agent is started. A managed
`finally` validates exact path, root ownership, type, mode, inode and device
before removing only its own short directory on success, error or handled TERM.
Prior signal handlers are restored. Cleanup failure fails provisioning. Successful
cleanup metadata is retained in public provenance without the random temporary
path. SIGKILL or VM loss cannot run cleanup; disposable-VM teardown remains the
backstop. This source repair requires fresh-head qualification, not a claim that
the failed browser job passed.

Playwright and playwright-core 1.56.1 tarballs are verified against the exact npm
lock SRI and extracted without npm, lifecycle scripts or browser downloads. Npm
signature/attestation provenance is not independently claimed. This keeps the
existing exact Playwright package version. The optional macOS dependency is not
installed on Linux. Public archives and GPG evidence remain root-owned beneath
`verification/`; the installer records the complete payload and exact source.

For every normal-UID browser case, set `VOLTEX_STOCKS_NATIVE_BROWSER=1` and
`QA_SOURCE_SHA` to that exact SHA. The fixed module is
`<prefix>/playwright/node_modules/playwright`. Public-host's explicit executable
argument is `<prefix>/chrome/chrome`. Existing preflight runs first, then:

```sh
node scripts/stocks-browser-native/qualification.cjs --output /absolute/fresh/evidence
```

The early qualification uses the unchanged real Chrome sandbox table and renderer
UID, namespace, executable, process-start, BPF/TSYNC and filter-count proof. It
does not replace any of the seven existing mandatory browser cases or the TLS
negative tests. Runtime validation checks all payload files and rejects extras,
links, special files, mismatched source, expiry, writable ancestors or changed
package bytes. `ldd` is invoked only after authentication, to record the resolved
loader dependencies and their actual immutable ancestry. Dynamically loaded
optional libraries and native kernel/LSM behavior still require actual browser
qualification; a package inventory alone is not a sandbox proof.

Cleanup, including job failure, uses the same source/run identity:

```sh
sudo /usr/bin/env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C /usr/bin/python3 -I scripts/stocks-browser-native/provision.py --cleanup --source-sha "$SHA" --run-id "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

Only the fresh, root-owned prefix with matching inode/device/owner marker can be
removed. No old installation, global package, keyring or unrelated directory is
removed. GitHub's fresh-VM disposal is additional cleanup, not a claimed result of
this script. SIGKILL/runner loss is not interceptable; cleanup remains an explicit
always-step gate. Parent workflow retains the existing 30-minute job limit.

## Trust and remaining qualification gates

GPG validates the Google primary fingerprint and current signed subkey, expiry,
revocation flags, signature time and Release age (72 hours maximum). Tampered
pinned source metadata or expiry causes failure, requiring another source review.
The original public `InRelease` and `Packages.gz` bytes are retained under
`metadata/` and admitted as exact Git blobs before any privileged mutation; CI
does not refetch their mutable repository URLs. Their original hashes and Chrome
package pin are unchanged. Three literal `-text` attributes preserve those exact
bytes across checkout platforms. The official Google key is still fetched freshly and
must match both its original hash and committed key bytes, so a changed key or
new revocation cannot silently be replaced by the stored copy. GPG verification
and the original time limits still run on every provisioning attempt. This
snapshot's Release date is 2026-10-14 20:54:09 UTC; its 72-hour bound ends at
2026-10-17 20:54:09 UTC, or sooner if another signature/key expiry gate applies.
No source snapshot extends that window or authorizes an unverified repin.
`chain.cjs` copies the pure verifier from the archived source proposal (original
SHA256 `a1b811d655502a0858ce2586f506e85195d8ba404471d998c6b1c1607ad3e5b9`);
it does not import or activate that proposal. The Python verifier mirrors these
checks before extraction. Retained GPG status is installer-produced, immutable
evidence of actual verification, not an independent signature on handwritten JSON.

After the public-key listing and signature-decrypt commands both return zero,
the provisioner emits a JSON-escaped public GPG witness to stderr immediately
before the unchanged signature parser. It binds the exact source/run/time,
original key/index hashes, command exit codes, and complete public status/listing
bytes and digests. It is diagnostic evidence, not signature acceptance, and
survives cleanup through the CI log. The entire emitted JSON line is bounded to
128 KiB; an oversized witness emits only lengths/digests and fails explicitly
without running signature validation. Nothing is silently truncated, written to
stdout, or accepted on the strength of this witness.

The captured public witness from CI source `926291d6` is retained unchanged as
`fixtures/gpg-status-926291d6.json` for regression tests only; it is never a live
installation proof. Its fifteen `KEYEXPIRED` notices identify five unused,
expired signing subkeys, each reported three times. A notice is deferred only
after the pinned primary and selected signer pass the existing validity gates,
and only when its positive integer timestamp uniquely identifies an expired
unused subkey with a complete, unique fingerprint. This exception also requires
one ordered `NEWSIG` / matching `GOODSIG` / `VALIDSIG` sequence and no notice
before `NEWSIG`. Ambiguous identities, unmatched/malformed timestamps, an expired
primary or selected signer, and every other fatal status (including
`KEYREVOKED`) still fail. Duplicate notices for an identified unused subkey are
allowed; no key expiry window or package/signature pin is extended.

Video capture requires the separate FFmpeg revision `1011` referenced by the
SRI-bound Playwright 1.56.1 `browsers.json`. The source manifest pins the exact
official ZIP, its two regular members (`ffmpeg-linux` and `COPYING.LGPLv2.1`),
their sizes, modes and SHA256 digests. The archive was obtained over verified
HTTPS from the source-listed Playwright CDN on 2026-10-15 and redirected to the
source-listed Microsoft host. The installer uses that exact observed final URL
directly; redirects remain prohibited. These are reviewed measured digest pins
with HTTPS-origin authentication, not a publisher detached signature or the
Google APT signature chain used for Chrome.

Before any FFmpeg payload write, the installer checks the complete ZIP hash,
exact two-entry inventory, regular-file types/modes, canonical fixed names,
compression flags, byte bounds and both uncompressed hashes. It extracts only
into the new `<prefix>/browsers/ffmpeg-1011` directory and includes every file in
the immutable installation inventory. No downloaded executable or package
script runs as root. The runtime must use that fixed `PLAYWRIGHT_BROWSERS_PATH`
before importing Playwright and qualify real video recording; the user cache,
system FFmpeg and unverified alternate binaries are not fallbacks. Existing
Chrome sandbox, TLS, seven-case acceptance and owned-process cleanup gates remain.

Actual CI kernel/user namespace availability, `/proc` readability after sandbox
dumpability changes, library compatibility, and seven-case acceptance remain
unproven until execution. A native VM has normal network access; existing fixture
request/WebSocket denial guards remain in force, but this is not a kernel-level
network egress isolation claim. Ubuntu22 is currently supported but deprecated;
retirement is announced for 2027-04-17. No capacity claim follows from this QA.

Primary references:

- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://github.com/actions/runner-images/blob/573fa3ad959907712ce8bf6a5f91ab82b03e7f2d/images/ubuntu/scripts/build/configure-system.sh
- https://github.com/actions/runner-images/blob/573fa3ad959907712ce8bf6a5f91ab82b03e7f2d/images/ubuntu/Ubuntu2204-Readme.md
- https://github.com/actions/runner-images/issues/14254
- https://www.google.com/linuxrepositories/
- https://github.com/gpg/gnupg/blob/gnupg-2.2.27/common/asshelp.c#L460
- https://man7.org/linux/man-pages/man7/unix.7.html
- https://playwright.dev/docs/browsers#chromium-sandbox
