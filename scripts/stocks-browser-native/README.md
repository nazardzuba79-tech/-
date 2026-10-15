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
revocation flags, signature time and Release age (72 hours maximum). Exact pinned
metadata changing or expiring causes failure, requiring another source review.
`chain.cjs` copies the pure verifier from the archived source proposal (original
SHA256 `a1b811d655502a0858ce2586f506e85195d8ba404471d998c6b1c1607ad3e5b9`);
it does not import or activate that proposal. The Python verifier mirrors these
checks before extraction. Retained GPG status is installer-produced, immutable
evidence of actual verification, not an independent signature on handwritten JSON.

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
- https://playwright.dev/docs/browsers#chromium-sandbox
