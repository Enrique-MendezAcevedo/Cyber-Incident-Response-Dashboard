# Aegis Command — working hackathon demo

A command center for incident coordination during and after a cyber incident. Release **1.0.0** implements all six review priorities: independent access/deployment, incident documentation, compromised-data scope, evidence and after-action reports, lessons/improvement actions, and a tested demo/recovery workflow.

## Run the demo

Requirements: **Node.js 24+**, npm, and an installed **Google Chrome/Chromium**. From this folder:

```sh
npm ci
npm run demo
```

The launcher starts **http://localhost:8080**, creates a fresh synthetic scenario and opens four isolated, authenticated Chrome profiles. No physical key is needed: the rehearsal uses Chrome's test-only virtual WebAuthn keys with the actual registration/signature-verification flow. The UI permanently labels this profile **SYNTHETIC REHEARSAL**. It does not use corporate SSO, email, CDN assets, cloud AI or a remote chat service.

| Window / username | Role |
|---|---|
| Maya Chen / `maya` | Commander and administrator |
| Alex Rivera / `alex` | Responder |
| Jordan Lee / `jordan` | Second commander and administrator |
| Olivia Park / `olivia` | Observer |

Keep the terminal open. Use the Chrome Window menu to switch profiles. If the port is busy, run `npm run demo -- --port 8081`. Set `AEGIS_CHROME` to the installed browser executable if automatic detection fails.

The prepared **Northbridge ransomware** incident includes affected data, tasks, facts versus hypotheses, a pending decision, evidence provenance and a quarantined synthetic original, plus an improvement action. Each launch uses a NEW private directory under `runtime/demo-runs/`; it does not reset or overwrite previous runs or ordinary deployment data.

## Demo it to judges

Use [PRESENTER_SCRIPT.md](PRESENTER_SCRIPT.md) for the three-minute demonstration.

The complete script, sample field values and troubleshooting are in [DEMO.md](DEMO.md). An 8–10 minute walkthrough is:

1. **Maya → Overview:** show severity, commander, phase, freshness, confirmed facts versus hypotheses, next actions and Focus view.
2. **Maya and Alex → Communications:** post a critical instruction, observe it in the second window, explicitly acknowledge it and show the named acknowledgment. Olivia's window is read-only.
3. **Maya → Scope:** edit Customer records to Accessible and recovery Validated, provide validation evidence and a rationale. Suspected exposure/exfiltration remain. Show history, unknown counts, ownership and overlap handling. Optionally trigger a concurrent-edit conflict in Maya/Alex windows; the losing draft is preserved.
4. **Alex/Maya → Evidence:** show source, collector, collection/receipt times, SHA-256 and custody history. Register/upload a harmless file if desired. Originals start quarantined, are never previewed or unpacked, and require a separate commander's recorded review before controlled download.
5. **Alex → Tasks, Maya → Review:** complete the clean-restore task with evidence, move into Recovering, then close with impact, risk disposition, validation and a review owner/due time. The owner completes the review. Reopening records a reason and retains prior closure history.
6. **Alex → Review:** complete the linked improvement action and its lesson. These remain actionable after incident closure.
7. **Maya → Request incident report; Jordan → preview and approve:** Maya downloads the readable HTML report and verification manifest. Show scope, decisions, communications, evidence/custody, lessons, closure and timeline in the report. JSON and formula-safe scope CSV are also available. Print the HTML through the browser if a PDF is desired.
8. In the original terminal type **`restart`** to demonstrate persisted encrypted state and reconnection, or **`backup`** to create a consistent encrypted recovery point. Maya can also suspend Alex in People and demonstrate immediate loss of access.

The report requester cannot approve their own sensitive export. Only the requester can download after a distinct active assigned commander approves. Downloads are reauthorized and expire after 24 hours. Evidence review authorizes a controlled original transfer; **it is not an antivirus or evidence-truth claim**.

## Stop, continue or reset

- Type `quit` or press Ctrl+C in the demo terminal to close its server and browser profiles.
- Run `npm run demo` again for a fresh synthetic rehearsal.
- To continue a prior run, stop its old process and use the directory it printed:

```sh
npm run demo -- --resume "/absolute/path/to/runtime/demo-runs/PRIOR-RUN"
```

The encrypted virtual-key cache and runtime storage key must remain with that private rehearsal directory. They are test credentials, not a production enrollment/recovery mechanism. If a demo account was suspended, restore it before quitting if you intend to resume.

## Verify the product

```sh
npm run check
npm test
npm run test:browser
npm run demo:check
npm run verify:demo
```

`npm test` exercises real TLS certificates and signed WebAuthn responses, authorization/revocation, migrations, all incident/scope workflows, hostile uploads, encrypted evidence, report approvals/integrity, lessons/actions and backup/restore. `test:browser` covers the incident workflows with separately authenticated responders. `demo:check` runs the actual shipped launcher headlessly. `verify:demo` adds axe WCAG-tagged checks, keyboard/modal navigation, 320px/200% layouts, disconnected drafts, lost-response retry, a completed review/action workflow, process restart, fresh restore and resumed rehearsal.

The latest structured result, screenshots and a synthetic sample report are in [`../artifacts/demo-qa/`](../artifacts/demo-qa/). See [VALIDATION.md](VALIDATION.md) for exact coverage, operational limits and first-time-user task cards. Automated results are not presented as a human participant study or penetration-test certification.

## Independent HTTPS/mTLS deployment

Use [deploy/README.md](deploy/README.md) for the actual independent enclave: dedicated trusted hardware/network, clean clients, independent server/device roots, device certificates, physical FIDO2 keys, no corporate identity dependency, default-deny egress and a hardened unprivileged service.

The rehearsal stays on localhost HTTP with simulated keys. Production is the default configuration and refuses to start without an exact HTTPS origin, private storage key, server key/certificate and independent device CA. Production cannot enable the rehearsal flag. It does not trust proxy identity headers or expose a reusable bootstrap account.

For manual localhost development with **physical** keys, use a separate development vault:

```sh
node scripts/operator.mjs keygen --out runtime/secrets/storage.key
export AEGIS_MODE=development
export AEGIS_ORIGIN=http://localhost:8080
export AEGIS_KEY_FILE="$PWD/runtime/secrets/storage.key"
export AEGIS_DATABASE="$PWD/runtime/data/aegis.sqlite"
node scripts/operator.mjs bootstrap --first custodian1 --first-name "First Custodian" --second custodian2 --second-name "Second Custodian"
npm run dev
```

Enroll the two custodians using their printed 30-minute single-use invitations and different physical keys/browser profiles. Administrators have no default incident-content access. Create an incident with an explicit commander, or assign access in People and sign in again. Assign a second eligible commander to approve sensitive reports/originals. Register a spare physical key under My access. Admin elevation/account recovery need two custodians. Existing setups reuse their key/vault configuration; do not rerun key generation or bootstrap over them.

## Evidence, reports and recovery

- Evidence records retain provenance, collector, original collection time, server receipt, classification, source/location, declared and computed SHA-256, corrections and append-only custody events. Originals are stored outside the webroot as authenticated ciphertext, bounded to 5 MiB each/20 per record/100 MiB total, and never parsed, unpacked or previewed. Current rights and review status are checked on download.
- Incident reports capture fixed classified snapshots. Readable HTML, full incident JSON and scope CSV have a companion SHA-256 verification manifest. Original file bytes and platform credentials are excluded. All untrusted text is escaped; CSV formula prefixes are neutralized.
- Lessons link to owned, dated action tasks, or an explicit no-action disposition. Completion requires the action to be complete; accepting risk requires a commander and rationale. Closed incidents still accept review, evidence/custody and improvement work.
- Encrypted vault and evidence backups are consistent, hash/AEAD-verified and restored only into fresh destinations. The key is not included. Restore invalidates sessions/invitations/pending access approvals. Review and reapply authorizations revoked since the snapshot before exposing a restored service. [Exact operator commands](DEMO.md#operator-backup-and-restore-commands).

The vault schema advances from versions 1/2 to **3** inside the transaction boundary. Existing incidents, grants, revisions, communications and closure data are preserved; evidence/report/lesson collections are added. Keep an independent pre-upgrade encrypted copy and its separately controlled key before upgrading a real deployment. Older application versions are not supported readers of schema 3. The original unauthenticated ZIP's plaintext state is still not auto-imported.

## Offline distribution

After the dependencies have been installed/cached on the trusted build workstation:

```sh
# Independent appliance package: production dependencies only
npm run bundle -- --out /trusted-transfer/aegis-command-1.0.0.tar.gz

# Rehearsal package: also includes demo/browser/accessibility tooling and tests
npm run bundle -- --include-demo --out /trusted-transfer/aegis-command-demo-1.0.0.tar.gz
```

Builds use the locked local npm cache and include a SHA-256 file manifest. Runtime keys, cookies, databases, uploads and virtual-key caches are excluded. Sign/verify the archive using the separately trusted custodian release key before appliance deployment; the manifest alone is not a release signature. Chrome and Node are installed separately from trusted media. No package installation or internet connection is required to start the preassembled rehearsal archive.

The [PRD/TRD](requirements/) remain the broader production target. This release is a working hackathon implementation, with measured automated checks and explicit limits in [VALIDATION.md](VALIDATION.md). Physical trust/isolation, an independently administered audit collector, automatic recovery-node replication and formal human/security assessments remain deployment work.
