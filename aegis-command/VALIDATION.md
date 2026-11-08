# Demo validation and remaining operational gates

## Reproducible automated checks

Run from `aegis-command` with Node 24+, installed dependencies and Chrome/Chromium:

| Command | Evidence produced |
|---|---|
| `npm run check` | Syntax validation for application, operators, demo and tests |
| `npm test` | TLS/WebAuthn, permissions/revocation, schema migration, incident/scope, evidence, reports, improvement actions, backup/restore and hostile-input regressions |
| `npm run test:browser` | Two authenticated responders complete incident/scope workflows, concurrent edits, closure/review/reopening, revocation, mobile layouts and session-cache isolation |
| `npm run demo:check` | The shipped one-command rehearsal boots four roles, previews/approves/downloads a report, verifies its manifest, restarts and backs up |
| `npm run verify:demo` | axe WCAG tags on critical screens, keyboard/modal flows, reflow/zoom, evidence, offline retry, completed review/lessons, report export, fresh restore and rehearsal resume |

Generated evidence is in [`../artifacts/demo-qa/validation-results.json`](../artifacts/demo-qa/validation-results.json), with screenshots and a synthetic sample HTML report/manifest. The JSON identifies automated validation explicitly and records the actual run time and results. It contains no physical key material or production incident data.

Security cases include denial without a device certificate, unauthorized device admission, exact-origin/CSRF checks, unsigned or malformed WebAuthn assertions, synced credentials, forged authorship, revoked users/devices, cross-incident IDs, observer writes, stale revisions, upload limits, path-like filenames, disguised file signatures, quarantined downloads, source-digest mismatch, uploader self-approval, report self-approval, revoked export permission, report expiry/cancellation, CSV formula prefixes, hostile HTML content, AEAD tampering, backup corruption and restoration into an existing target.

Restart and restore are different tests: process restart retains committed records and valid sessions; restoration into a fresh target verifies original bytes, clears restored sessions/invitations/access approvals and requires new key authentication. Authorization changes made after a backup must be reapplied from an independent record before that restored service is exposed.

## Human first-use task cards

These are ready to run with representative first-time users. No participant results are filled in or claimed by the automated agent.

| Task | Observe without coaching | Proposed target |
|---|---|---|
| Identify the incident state | Name severity, responsible commander and freshness | 30 seconds |
| Declare an incident | Create a valid title/severity/rationale/commander/summary | 3 minutes |
| Add uncertain scope | Record a dataset, unknown quantity, owner, impact dimensions and rationale | 2 minutes |
| Acknowledge an instruction | Find a critical message and explicitly acknowledge it | 1 minute |
| Complete assigned work | Find an owned task and record completion evidence | 2 minutes |
| Preserve a conflict draft | Explain which values are unsaved versus saved | No mistaken save confirmation |
| Export a review record | Request, preview and approve using a different commander | No self-approval or role confusion |

For each participant record identifier, role, device/assistive technology, start/end times, successful completion, errors, requested help and whether any unsaved change was mistaken for saved. The PRD's proposed study requires at least ten representative participants; this template does not stand in for their participation.

## Operational boundaries

- The localhost rehearsal uses virtual security keys, synthetic records and independent Chrome profiles. It does not establish physical network isolation or clean endpoints.
- Production configuration enforces HTTPS/mTLS and individual non-synced WebAuthn credentials. The dedicated Linux firewall/systemd profile still needs execution and verification on the actual appliance. See `deploy/README.md` for the disconnected-network demonstration.
- Original uploads are encrypted opaque objects with bounded size and quarantine. They are not automatically scanned, unpacked, rendered or declared malware-free. A custodian records an external forensic review before controlled download.
- Reports are classified snapshots with two-person approval and verification hashes. They contain no original attachment bytes or platform credentials. Downloads remain sensitive files on the authorized recipient's device; this release does not implement recipient-public-key encryption or automatic redaction policies.
- Encrypted, consistent manual backups and fresh restores are implemented and exercised. A separately powered recovery node, automatic five-minute replication, full-site recovery and measured production RPO/RTO are not claimed.
- Hash chains and authenticated encryption protect stored records within the trusted enclave model. An independently administered audit collector/checkpoint service and independent penetration testing remain deployment work; the code does not certify resistance to a compromised running trusted server.
- Automated accessibility rules, keyboard checks and viewport checks passed when recorded in the result artifact. They do not certify every screen-reader combination or replace the human usability/accessibility review.
