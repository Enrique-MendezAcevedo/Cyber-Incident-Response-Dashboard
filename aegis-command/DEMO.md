# Aegis Command — hackathon demo guide

For the three-minute presentation, use [PRESENTER_SCRIPT.md](PRESENTER_SCRIPT.md). This guide covers setup and operating details.

## Start the prepared rehearsal

Install **Node.js 24 or newer** and **Google Chrome or Chromium**. Chrome does not need a separate Playwright browser download. From the repository root:

```sh
cd aegis-command
npm ci
npm run demo
```

The first install may need internet access. The running app does not. If using the supplied **demo archive**, its dependencies are already included: extract it, enter `aegis-command`, and run `npm run demo` without an install.

The launcher opens four isolated Chrome windows/profiles and enrolls their **test-only virtual WebAuthn keys** through the actual login and invitation endpoints. Their signatures are verified by the same server as ordinary keys. No password or persona-selector bypass is added. Every window has a persistent **SYNTHETIC REHEARSAL** banner, and every incident created in this profile is synthetic. This is a localhost functional rehearsal; it does not prove that this computer or its network is uncompromised.

| Window / username | Role | What to demonstrate |
|---|---|---|
| Maya Chen / `maya` | Commander and platform administrator | Coordinate, update scope, assign work, review originals, close incidents, request reports |
| Alex Rivera / `alex` | Responder | Document findings, upload evidence, complete assigned work and improvement actions |
| Jordan Lee / `jordan` | Second commander and administrator | Independently approve report exports and sensitive access requests |
| Olivia Park / `olivia` | Observer | Read the shared situation without mutation, original-download or export permissions |

**No physical security key is needed for this rehearsal.** Physical keys and approved device certificates remain required for the independent production profile. Keep the demo synthetic; its virtual private keys are encrypted in the private run directory solely so the rehearsal can be resumed.

The default address is **http://localhost:8080**. Keep the terminal open. If that port is busy:

```sh
npm run demo -- --port 8081
```

The terminal prints the actual address, role names and run directory. Find the windows by their titles, such as **Maya Chen · Aegis Command**. On macOS use Chrome's Window menu or switch between Chrome windows. These profiles do not use your ordinary browser history, corporate identity or synced credentials.

## Recommended 8–10 minute judge walkthrough

### 1. Establish the command center — Maya, about one minute

Start on **Northbridge ransomware → Overview**. Point out:

- Severity, responsible commander, phase and last successful synchronization.
- Confirmed facts versus a working hypothesis, with owners and review times.
- Pending work and the decision about returning to service.
- The separate data-impact dimensions: a dataset can be locked and suspected exfiltrated simultaneously.

Use **Focus view** to prioritize the situation, next actions and communications. Exit Focus view before moving to the other workspace sections. Optionally open **All incidents → Create incident** to show the short essential form; cancel it to keep this walkthrough on the prepared scenario.

### 2. Show live coordination — Maya and Alex, one minute

In Maya's **Communications**, post a short instruction and check **Require explicit acknowledgment**. In Alex's window, open Communications, observe the message and select **Acknowledge**. Return to Maya and show the named acknowledgment. This records an explicit user action rather than inferring a read receipt.

Switch briefly to Olivia's window. She sees the same incident, but cannot post messages, change scope or create a report. Each window represents a separately authenticated session.

### 3. Document affected data and show safe recovery semantics — Maya, one minute

Open **Scope → Customer records → Edit assessment**. Change:

- Availability: **Accessible**
- Recovery: **Validated**
- Recovery validation evidence: `EV-RESTORE — synthetic application and hash checks passed`
- Assessment rationale: `Clean restore validated; the exposure investigation remains open.`

Save. **Suspected exposure** and **Suspected exfiltration remain visible.** Expand revision history to show the previous Locked assessment. Quantities remain per dataset; they are not misleadingly summed across overlapping data.

To demonstrate new scope entry, use **Add asset or dataset**. Fill the name, stable identifier, business owner, category, classification and quantity bounds. Both quantity bounds blank mean unknown, not zero. Unknowns create an assigned follow-up task. Archive a duplicate with a reason; it remains in history.

### 4. Show conflict handling — Maya and Alex, optional one minute

Open the same scope item's edit dialog in both windows. Save a rationale change as Maya. Save Alex's older draft. Alex receives a conflict comparison; his draft remains in the dialog. **Load current version** requires an explicit confirmation before replacing the draft. Cancel after inspecting the comparison.

### 5. Evidence provenance and quarantine — Alex, then Maya, one minute

Open **Evidence**. `EV-014` already has a synthetic gateway original in quarantine. Expand its chain of custody and show collector, collection time, server receipt time, source location, classification and SHA-256.

As Maya, select **Review original disposition** on EV-014. Choose **Approved for controlled download** and enter a justification such as `Synthetic forensic review complete; approve controlled demonstration download.` Save. The uploader was Alex, so Maya is a separate custodian. A commander cannot approve their own uploaded original.

Use **Download controlled original** if desired. The app never opens or previews it. There is **no automatic malware-scanning claim**: originals remain quarantined until the separate forensic review is recorded. Metadata corrections that change provenance/classification return approved originals to quarantine.

To demonstrate new evidence, select **Register evidence**, enter provenance and a location reference, then optionally upload a file. The run directory contains harmless files under `sample-evidence/`:

- `gateway-transfer.log`
- `restore-validation.txt`

Only bounded forensic/text/image/document containers are accepted. The server rejects path-like names, unsupported active extensions, oversized originals and inconsistent supported file signatures. ZIP files are stored as opaque quarantined bytes and are never unpacked.

### 6. Complete the recovery record — Alex, then Maya, about one minute

As Alex, open **Tasks → Validate clean restore of customer records → Update task**. Mark Complete and record completion evidence. Record a finding or action in **Record** if time permits. Commanders can approve/update decisions with rationale and alternatives; a superseded decision links its replacement.

As Maya, open **Review → Change phase**. Move from Containing to **Recovering**, with a reason. Then choose **Closed** and supply:

- Final impact summary: `Synthetic customer service restored from a clean backup.`
- Unresolved risks/work: `Maya retains the suspected exfiltration investigation and its follow-up review.`
- Recovery validation: `EV-RESTORE — application and hash checks passed.`
- Review owner and due time: select Alex and a future UTC time.

Open work is not silently completed by closing the incident. Closure records its disposition. A commander can later reopen to Investigating with a reason, preserving the prior closure.

### 7. Lessons learned and accountable improvement — Alex, about one minute

In **Review**, show the prepared lesson **Rehearse the independent responder kit monthly**. Use **Update improvement action**, mark its task Complete and record the action/evidence, then use **Update lesson** to mark the lesson Complete with a reason. This work remains possible after incident closure. A lesson cannot be completed while its linked action is still open. Only a commander can accept its residual risk instead.

The review owner can also complete the scheduled post-incident review with notes. New lessons can either create an owned, dated task or explicitly explain why no action is required.

### 8. Export the completed incident — Maya and Jordan, one minute

As Maya, in **Review → Request incident report**, select **Readable HTML after-action report** and enter the recipient/purpose. The report captures a fixed snapshot and begins Pending.

In Jordan's window, open Review, select **Preview requested report**, inspect the content, then **Approve report as second commander** with a rationale. Maya cannot approve her own request.

Back in Maya's window, download **the approved report** and **the verification manifest**. The readable report contains situation/impact, scope, findings/actions, tasks, decisions, evidence/custody, communications, lessons, closure/review, timeline and preserved revisions. Original evidence bytes and platform identity credentials are not included. Expand the revision appendix only if needed. Print the HTML using Chrome's Print command; Save as PDF is available through the browser's normal print dialog.

Verify the artifact locally (Mac/Linux):

```sh
shasum -a 256 /path/to/IR-2026-017-report.html
```

Compare it with `sha256` in the companion manifest. JSON and formula-safe scope CSV exports are also available. Approval is tied to the requested snapshot. Revoked requester/approver access, cancellation or 24-hour expiry blocks downloads.

### 9. Demonstrate continuity — terminal, optional one minute

In the original demo terminal, type `restart` and press Enter. Committed encrypted records and sessions survive the process restart; browsers reconnect. Unsaved work stays in memory while the connection is unavailable, up to the existing session expiry. Server-denied/revoked access clears it.

Type `backup` and press Enter to create a consistent encrypted vault/evidence snapshot outside the live data directory. It verifies referenced originals before claiming success. The storage key is deliberately absent from the backup. A successful restore into a fresh directory, key reauthentication and record/evidence continuity are exercised by `npm run verify:demo`.

For a live access-control proof, Maya can suspend Alex in **People** and show his window lock. Restore his access as Maya; Alex types username `alex` and presses **Sign in with security key** to use his virtual key again. Avoid leaving an account suspended if you plan to resume this run later.

## Stop, restart or reset the rehearsal

- Type `quit` or press Ctrl+C in the demo terminal to close the demo and its isolated browser profiles.
- Run `npm run demo` again for a **fresh** synthetic scenario. It creates a new directory and does not overwrite earlier runs or any ordinary deployment vault.
- To continue a prior scenario, first stop its old process, then use the exact directory printed by that run:

```sh
npm run demo -- --resume "/absolute/path/to/runtime/demo-runs/PRIOR-RUN"
```

- The encrypted test-key cache is required to resume. Account access must still be active. A missing/corrupt cache does not grant a password fallback; start a fresh rehearsal instead.

## Operator backup and restore commands

Every demo run writes `demo.env` containing paths/configuration, not secret key bytes. From `aegis-command`, use its absolute path:

```sh
node --env-file="/absolute/run/demo.env" scripts/operator.mjs backup --out "/independent/storage/new-backup"
```

For restore, create a NEW environment file that retains the original `AEGIS_KEY_FILE` but points `AEGIS_DATABASE` and `AEGIS_EVIDENCE_DIR` to fresh destinations. Then:

```sh
node --env-file="/absolute/restore.env" scripts/operator.mjs restore --from "/independent/storage/new-backup" --acknowledge-authorization-rollback
```

Restore verifies the vault, ciphertext manifests, AEAD authentication and original SHA-256 values before creating the target database. Existing databases/evidence directories are not overwritten. It revokes restored sessions, pending invitations and pending access approvals. **A backup cannot know which grants were revoked after its capture.** Keep the service isolated until custodians review/reapply those revocations using the latest independent record. The flag acknowledges that actual rollback consequence. Keep the encryption-key recovery copy separately; it is never included in the backup directory.

## Reproduce the checks

```sh
npm run check
npm test
npm run test:browser
npm run demo:check
npm run verify:demo
```

`verify:demo` writes screenshots, a sample report/manifest and structured results to `artifacts/demo-qa/` at the repository root. It checks WCAG-tagged axe rules, critical keyboard/modal flows, 320px reflow, 200% zoom, evidence review/download, disconnection/retry, process restart, fresh restore and the report approval workflow. These are automated checks; they are not a penetration test, a physical-network exercise, or a study with first-time human responders.

For a first-use rehearsal, give another person only these task cards: create an incident; identify severity/owner/freshness; add uncertain scope; acknowledge an instruction; complete an assigned task; request a report. Record completion time, mistakes and assistance in `VALIDATION.md`'s human-study template. Do not present uncollected participant results as measured success.

## Troubleshooting

| Symptom | Action |
|---|---|
| Chrome not found | Install Chrome/Chromium, or set `AEGIS_CHROME` to its executable path before running the command. macOS/Linux common paths are detected automatically. |
| Port 8080 already in use | Stop the prior process or use `npm run demo -- --port 8081`. |
| Dependencies absent | Run `npm ci` from the source folder, or use the preassembled demo archive. |
| “Verify your hardware key again” | Open My access → Verify key again in that window; the rehearsal virtual key responds automatically. |
| Access changed / session expired | Re-enter the displayed demo username and choose Sign in with security key. Suspended users must first be restored by Maya/Jordan. |
| Cannot approve original/report | Use a different eligible commander. For reports, Jordan approves Maya's request; only Maya downloads it afterward. |
| Evidence digest mismatch | Compare the declared source digest with the computed attachment hash. Correct metadata with a recorded reason or reject the original. |
| Backup database busy | Finish active uploads/writes, then retry. A failed backup is not a verified recovery point. |
| Demo resume cannot use a key | Keep the full private run directory, including `secrets/virtual-keys.aegis` and the separately stored runtime key. Otherwise start fresh. |

Use `deploy/README.md` for the actual independent HTTPS/mTLS enclave. The rehearsal does not substitute for dedicated clean devices, independent roots, network isolation or operating procedures.
