# Cyber Incident Response Dashboard — Aegis Command 1.0

A working hackathon command center for coordinating a cyber incident and preserving its review record. It includes independent access control, multiple incidents, compromised-data scope, live communications, evidence provenance/quarantine, after-action reports, lessons/improvement actions and tested backup/restore.

## Run the prepared demo

Install **Node.js 24+** and **Google Chrome or Chromium**, then run from this repository:

```sh
cd aegis-command
npm ci
npm run demo
```

The launcher opens **http://localhost:8080** in four separately authenticated Chrome profiles. It creates a fresh synthetic ransomware scenario and enrolls test-only virtual security keys through the real WebAuthn flow. **No physical key is needed for this rehearsal.** The running app needs no internet connection after dependencies/browser/runtime are prepared. The preassembled demo archive includes dependencies and can run with `npm run demo` directly after extraction.

| Window | Role |
|---|---|
| Maya Chen (`maya`) | Commander/admin |
| Alex Rivera (`alex`) | Responder |
| Jordan Lee (`jordan`) | Second commander/admin |
| Olivia Park (`olivia`) | Observer |

Keep the terminal open. Find windows by their titles in Chrome's Window menu. Use `npm run demo -- --port 8081` if 8080 is occupied. If Chrome is not detected, set `AEGIS_CHROME` to its executable path.

## Judge walkthrough

Use the [three-minute presenter script](aegis-command/PRESENTER_SCRIPT.md) for the short demonstration.

1. **Overview:** show severity, commander, phase, freshness, facts versus hypotheses and Focus view.
2. **Communications:** Maya posts a critical instruction; Alex explicitly acknowledges it. Olivia sees the incident without write controls.
3. **Scope:** set Customer records to Accessible/Validated with evidence and a reason. Exposure/exfiltration remain independent. Show quantity uncertainty, history and a two-window edit conflict.
4. **Evidence:** show source/collector/time/hash/custody. Originals start encrypted and quarantined; a separate commander records a forensic review before controlled download. They are never previewed or unpacked.
5. **Tasks and lifecycle:** Alex completes the restore task; Maya records recovery, closes with risk/validation/review details, and can reopen with history intact.
6. **Review:** complete the assigned review and lesson's improvement task. Maya requests a report, Jordan previews/approves, and Maya downloads the readable report and verification manifest.
7. In the original terminal, type `restart` to demonstrate continuity or `backup` to create a verified encrypted recovery point. `quit` or Ctrl+C stops the rehearsal.

See [the full 8–10 minute demo script](aegis-command/DEMO.md) for sample inputs, report hash verification, controlled restore, resume and troubleshooting. Every new `npm run demo` creates a new run directory and preserves prior runs. To continue one after stopping it:

```sh
npm run demo -- --resume "/absolute/path/to/runtime/demo-runs/PRIOR-RUN"
```

## Verify and inspect

From `aegis-command`:

```sh
npm run check
npm test
npm run test:browser
npm run demo:check
npm run verify:demo
```

The validation command writes actual results, screenshots and a synthetic sample report/manifest under [`artifacts/demo-qa/`](artifacts/demo-qa/). It checks accessibility rules, keyboard/modal operation, mobile/zoom layouts, disconnected drafts, duplicate-safe retry, report approval, restart, fresh restore and resumed rehearsal. Human-study task cards and actual operational limits are documented in [VALIDATION.md](aegis-command/VALIDATION.md).

- [Application setup, capabilities and physical-key development](aegis-command/README.md)
- [Full demo instructions](aegis-command/DEMO.md)
- [Prepared demo archive and validation artifacts](artifacts/README.md)
- [Independent HTTPS/mTLS enclave deployment](aegis-command/deploy/README.md)
- [Workflow guide and standards mapping](aegis-command/WORKFLOWS.md)
- [Original product requirements](Cyber_Incident_Response_PRD.md) and [technical proposal](Cyber_Incident_Response_TRD.md)

The localhost rehearsal is explicitly synthetic and uses simulated keys. It does not establish physical network isolation or clean endpoints. The independent deployment profile retains real HTTPS/device certificates, individual hardware keys, restricted enrollment and server-side permissions. Originals are quarantined with an external forensic-review workflow, not an automatic malware-free claim. Automated validation is not represented as a penetration test or first-time-human-user study.

`aegis-command.zip` is the old unauthenticated prototype, retained only as a reference. Use the `aegis-command/` source or the new 1.0 distribution archives in `artifacts/`.
