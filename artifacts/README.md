# Aegis Command 1.0 demo and release artifacts

- [Prepared demo archive](aegis-command-demo-1.0.0.tar.gz): source, locked dependencies, browser tests and synthetic rehearsal launcher. Requires Node.js 24+ and installed Chrome/Chromium. Extract, enter `aegis-command`, then run `npm run demo`; no dependency download is required.
- [Independent appliance archive](aegis-command-1.0.0.tar.gz): source and production dependencies. Follow its `deploy/README.md` for the dedicated HTTPS/mTLS appliance; this archive omits the browser-test dependencies.
- [Sample completed after-action report](demo-qa/sample-after-action-report.html) and [verification manifest](demo-qa/sample-after-action-report.manifest.json).
- [Automated validation results](demo-qa/validation-results.json) and screenshots in `demo-qa/`.

The demo archive was extracted into a fresh directory and passed `npm run demo:check`, including actual WebAuthn rehearsal enrollment, report approval/download and digest verification, process restart and encrypted backup. The source passed all 33 automated tests, the browser workflow regression suite, syntax checks and the extended demo verification. Recorded accessibility checks found no axe violations on the seven checked screens; these are automated results, not a human usability study.

Both archives exclude runtime records, secret keys and browser profiles. Each contains `MANIFEST.json` and `scripts/verify-manifest.mjs` for file integrity checks. The archives are unsigned; independent release signing/verification for appliance deployment is described in `deploy/README.md`. The older 0.2 and 0.3 archives are retained as historical builds.

SHA-256 of the 1.0 archives:

```text
f01b1c5464423838078ac214d9f2924b7e6ca78a1509b9b960929d9f2c173f3f  aegis-command-1.0.0.tar.gz
21080b8412ab3e2c06b09e98053cd8e6ac7f9ba48cb63aa4980dda0310d22ae8  aegis-command-demo-1.0.0.tar.gz
```
