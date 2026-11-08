# Cyber Incident Response Dashboard
## Technical Requirements Document

**Version:** 1.0 · **Date:** 7 November 2026 · **Status:** Proposed implementation baseline  
**Companion:** Cyber Incident Response Dashboard Product Requirements Document  
**Audience:** Architecture, engineering, security, operations and quality assurance teams

## 1 Architecture decision

Implement a single-organization web application inside a dedicated response enclave with independent identity, clean responder devices, a separate management plane and no required outbound services. Use a modular application, relational system of record, private evidence store and durable event stream. Deliver local real-time collaboration without depending on corporate infrastructure.

The baseline is a prepared on-premises kit on dedicated hardware. It uses a physically separate switch and wireless access point if needed, a dedicated firewall, clean laptops, independent authentication tokens and a separate recovery node. Do not deploy onto the organization’s existing hypervisor, domain-managed endpoints, storage cluster or administration plane. An alternative external enclave needs its own separately reviewed infrastructure and identity trust boundary; it is not part of this MVP.

## 2 Threat model and trust boundaries

Assume the attacker controls corporate user and administrator accounts, SSO, email, DNS, proxies, endpoints, servers and ordinary network paths. They can intercept or replay traffic, submit malicious files, steal an active responder session on a compromised device and attempt denial of service. They may possess an otherwise legitimate responder account. All imported incident content is untrusted.

Trusted components are the verified enclave hardware and boot chain, clean clients, isolated management workstations, enclave identity and certificate roots, signed installation media, credential custodians and the independent recovery environment. Trust in these components must be established before activation. They are not protected merely because the application calls them trusted.

| Threat | Required control | Residual limitation |
|---|---|---|
| Corporate identity takeover | No corporate federation, email recovery or shared administrators | An enclave credential and clean-device compromise can still expose authorized content |
| Network interception and spoofing | Separate network, pinned enrollment root, mutual TLS at gateway and hardware-key authentication | Physical jamming or cable removal can deny service |
| Malicious endpoint | Admission only for prepared managed devices; separate management | Device attestation or enrollment does not prove absence of all malware |
| Malicious member | Incident and channel grants, export approvals, rate limits and audit | Authorized users can photograph or manually disclose visible information |
| Hostile evidence file | Quarantine, disabled inline active content and isolated scanning | Scanners can miss novel malware; original downloads remain controlled |
| Privileged server compromise | Least privilege, split custodians, protected backups and external audit checkpoints | A fully compromised trusted application server can read plaintext and forge future application events |
| Ransomware or storage failure | Separate encrypted recovery copies and restore exercises | Shared power or physical location remains a common failure domain |

The system protects collaboration from compromised surrounding infrastructure. It cannot guarantee confidentiality if every device and the enclave itself are compromised. Hardware deployment and clean clients are part of the solution, not optional hardening.

## 3 Deployment and components

Traffic flows from a clean client through an enclave gateway to the application. The application accesses the database, identity service and evidence store over private authenticated connections. A dedicated worker handles scanning, reporting and backup coordination. A separate collector receives signed audit checkpoints; the recovery node receives encrypted backups. Corporate infrastructure has no route to backend or management interfaces.

| Component | Proposed implementation | Responsibility |
|---|---|---|
| Web client | TypeScript and React, bundled static assets | Accessible workflows and local display state |
| Gateway | Hardened reverse proxy supporting TLS and device certificates | Connection admission, security headers and rate limits |
| Application | Go modular service with REST and WebSocket endpoints | Authorization, business rules, revisions and transactions |
| Identity | Locally deployed maintained identity service supporting WebAuthn | Independent accounts, authentication and session controls |
| System of record | PostgreSQL | Records, permissions, revisions, audit and transactional outbox |
| Evidence storage | Private S3-compatible object store with version and retention controls | Original bytes, quarantine and custody-linked metadata |
| Worker | Separately sandboxed processes | Scan, safe report generation, exports and maintenance |
| Audit and recovery | Independently administered collector and backup target | Checkpoint anchoring, retained copies and restore |

Pin supported component versions during implementation and track them in a software bill of materials; this document does not assert unverified version compatibility. Avoid Kubernetes for the initial kit unless the operational team already supports an independent, hardened cluster. Signed service bundles and a host service manager reduce setup dependencies.

Provide local authoritative DNS and time, a private certificate authority and preconfigured client trust. Clients must resolve the same HTTPS origin for WebAuthn. DNS poisoning must not bypass certificate validation. No internet fonts, analytics, CDN assets, remote license checks, crash uploads or third-party chat widgets are permitted. Updates enter through a verified offline import process.

## 4 Identity and authorization

**T01 — Bootstrap.** Provision the first two named custodians from signed installation media in a supervised ceremony. Remove bootstrap secrets immediately after enrollment. Record the installed image digest, device inventory and credential identifiers. The recovery kit contains sealed credentials or shares held separately; it contains no universal hard-coded account.

**T02 — Device and person authentication.** Gateway admission requires an enclave-issued device certificate whose private key is hardware-protected where available. User authentication requires a FIDO2 hardware key with user verification. Provision a second hardware key or controlled recovery procedure per user. Disable synced credentials that depend on corporate accounts. Never provide a certificate-warning bypass as an onboarding step.

**T03 — Sessions.** Use opaque server-side sessions in Secure, HttpOnly, SameSite cookies. Apply CSRF protection to mutations and origin checks to WebSocket upgrades. Default inactivity limit is 15 minutes and absolute lifetime 12 hours, with a warning that permits re-authentication. Require recent hardware-key verification for role elevation, recovery, sensitive export and key administration. Do not store tokens in localStorage.

**T04 — Authorization.** Evaluate user status, device status, incident membership, role capabilities and narrower channel or evidence grants on every operation. UUIDs are identifiers, not permission checks. Query filtering and direct object checks enforce the same policy. Add database row-level policy as defense in depth where compatible with the chosen service model. Background workers act with explicit scoped job grants.

**T05 — Revocation.** A suspension increments the principal’s authorization version, invalidates sessions, closes subscriptions and denies future requests. Connected sessions check invalidation events immediately and revalidate at least every five seconds. Failure to reach the authorization service fails closed. Revocation cannot retract already viewed or exported data.

Two custodians approve administrator grants and account recovery. Recovery issues a single-use 15-minute token after independent identity verification, revokes previous sessions and credentials as appropriate, and triggers an audit event. Default emergency access expires after one hour and never bypasses audit.

## 5 Domain model and state rules

All primary entities use opaque UUID identifiers. Store UTC timestamps with subsecond precision, display local time with timezone and allow UTC viewing. Preserve user-supplied event time and offset separately from authoritative server receipt time. Record clock uncertainty where source time is unreliable.

| Entity | Essential fields and relationships |
|---|---|
| User and Device | Status, credential references, device certificate, enrollment and revocation times |
| Grant | Principal, role, incident or channel scope, approver, expiry, authorization version |
| Incident | Title, severity, rationale, owner, phase, discovery time, summary, impact, revision |
| TimelineEntry | Incident, type, occurred time, recorded time, author, source, body, superseded reference |
| ScopeItem | Incident, asset or dataset, category, owner, sensitivity, count range and unit, independent impact dimensions, confidence, assessment time |
| EvidenceLink | Scope or event link, evidence ID, assessment relationship and rationale |
| Task and Decision | Incident, owner, status or outcome, deadline, rationale, links and revision |
| Channel and Message | Incident, grant scope, author, durable sequence, text, reply reference and revision |
| Acknowledgment | Message, user, explicit acknowledgment time; unique per user and message |
| Evidence and CustodyEvent | Object version, SHA-256 digest, collector, source time, receipt time, quarantine state and transfer history |
| AuditEvent | Sequence, actor, device, action, object, result, server time, revision references and prior hash |
| ExportJob and Hold | Scope, policy, requestor, approvals, manifest, expiry and retention restrictions |

Scope status enumerations match SC02 in the PRD. Do not implement a single “compromised” flag. Evidence confidence is an assessment, not a computed probability. Use count lower and upper bounds, explicit units and optional overlap-group identifiers; unknown is nullable with a reason, never zero.

Incident transitions follow IR02. Containment and recovery tasks can run during another phase. The server enforces closure prerequisites, authorized transitions and reopening reasons. All substantive records use integer revision numbers and immutable prior versions. Deletion creates a tombstone subject to hold and retention rules; ordinary users cannot erase history.

## 6 API and real-time consistency

Version the API under `/api/v1`. Validate request schemas, input length, enum values and object scope on the server. Default collection pages contain 50 items, maximum 200, using stable cursor pagination. Rich text is not required in MVP; escaped plain text with safe limited formatting reduces injection risk.

| Operation | Contract |
|---|---|
| POST /incidents | Validated creation; returns ID, revision and server time |
| PATCH /incidents/{id} | Requires If-Match revision; mismatch returns 409 with current authorized version |
| POST /incidents/{id}/scope | Creates independent impact assessment with evidence links |
| PATCH /scope/{id} | Requires revision and assessment rationale |
| POST /channels/{id}/messages | Requires unique client submission ID; retries return the original accepted result |
| POST /messages/{id}/acknowledgments | Idempotent explicit acknowledgment |
| POST /evidence/uploads | Creates scoped quarantine upload; enforces size and type policy |
| POST /incidents/{id}/exports | Creates asynchronous approval-controlled export job |
| GET /events | Authorized recovery stream after a sequence cursor |
| WebSocket /stream | Authorized subscriptions and committed event delivery |

Commit record mutations, audit entries and outbox events in one database transaction. Return success only after durable commit. The outbox worker publishes events at least once; clients deduplicate by event ID and preserve per-incident sequence order. There is no promise of globally ordered events across incidents.

Use 15-second heartbeats. After two missed heartbeats show **Disconnected — last synced at [time]**. Reconnect using the last applied sequence; if the retained stream is unavailable, load a fresh authorized snapshot and its high-water mark. Never label a stale snapshot Live.

The MVP supports operation without internet while connected to the enclave. It does not support durable disconnected client editing. In-flight input can remain in memory while the page is open, visibly marked Unsaved; warn before navigation. On reconnection, revalidate identity and permissions before resubmission. Do not persist sensitive drafts or evidence in browser caches or service workers.

## 7 Data protection and evidence handling

**T06 — Encryption.** Use TLS 1.3 on client and service connections where supported, and restrict any compatibility exception to a documented reviewed configuration. Encrypt database, object and backup storage with independently managed keys. Use a maintained cryptographic library and authenticated encryption for application-managed envelopes; do not design a custom cipher.

Keep key-encryption keys outside application storage, preferably in the enclave’s hardware-backed key service. Give incident data separate data-encryption keys where supported. Rotation rewraps data keys and preserves access to retained backups. Recovery of keys requires two custodians and is tested with restoration. Storage encryption protects offline media, not plaintext from an authorized or compromised running server.

**T07 — Attachment pipeline.** Default maximum original attachment size is 100 MiB, configurable by an administrator; initial kit evidence budget is 100 GiB. Upload in bounded chunks and verify the complete server-side SHA-256 digest. Detect actual type, reject path traversal, and quarantine all originals. Scan with offline-updatable signatures in a resource-limited worker with no network egress. Bound archive depth, expansion ratio and execution time. Do not unpack archives automatically in the application process.

No inline HTML, SVG, scripts, macros or original Office document previews. Safe preview generation, if implemented, occurs in a disposable sandbox and produces inert output. A custodian can authorize original download with recorded justification and a warning. Never auto-open a download. Deny public object URLs and check current authorization at download time.

**T08 — Exports.** Generate a human-readable report and machine-readable JSON or CSV with a manifest. Escape spreadsheet formula prefixes in CSV. Restrict exported records to the intersection of the requester’s grants and approved export scope, rechecking at job execution and download. Apply redaction server-side. Full sensitive exports require a second authorized person. Encrypt sensitive export packages for an approved recipient key; export artifacts expire after 24 hours by default while the audit manifest remains retained.

## 8 Audit retention and disaster recovery

**T09 — Audit integrity.** Log successful changes, authentication outcomes, authorization denials, access grants, exports, evidence transfers, recovery and administrative operations. Do not log passwords, session secrets or raw sensitive message bodies in operational logs. Audit records reference protected record revisions when content history is needed.

Chain canonical audit records using sequence numbers and hashes, and sign checkpoints every minute with a key held outside the application. Send checkpoints to the separately administered collector and alert on gaps or mismatch. Hash chains alone cannot prevent a privileged attacker from rewriting history and recomputing hashes; retained external checkpoints bound that risk. New mutations fail closed when their transactional audit entry cannot be persisted. Collector failure triggers a health alarm while locally durable audited writes can continue; loss of external anchoring is explicitly visible.

**T10 — Retention.** Proposed deployment defaults are 365 days after incident closure for incident content, evidence and audit, and 30 days for routine diagnostic logs. The organization must approve or replace these defaults before production. Legal hold overrides content deletion. Purge requires authorized approval, a recorded manifest, removal of eligible object versions and documented backup expiry. Immutable retained backups may outlive a primary deletion until their defined expiry; the UI and policy must state this.

**T11 — Backup and restore.** Take encrypted nightly base backups and ship encrypted database recovery logs to the independent recovery node at intervals no longer than five minutes. Copy evidence versions and manifests so the restored database never falsely claims an attachment is present. Missing recent evidence is reported explicitly. Preserve at least seven daily and four weekly recovery points subject to hold and retention policy.

Target RPO is five minutes and RTO 60 minutes for primary-node loss with a functioning recovery node, available clean spare hardware and two custodians. The recovery point is the latest verified consistent database and evidence checkpoint. Fence the failed primary before promoting recovery to prevent split-brain writes. Re-establish identity, keys, certificates and authorization state; revoke sessions and verify hashes before reopening. Run a quarterly timed restore and a restore before release. Full-site loss requires an additional off-site independent copy and a separately agreed objective.

## 9 Frontend implementation and accessibility

Implement semantic design tokens for canvas, surface, ink, secondary ink, brass, border, focus and severity. Use the PRD palette as the starting specification and test actual pairings; decorative dividers may be subtle, but control boundaries and focus indicators must meet applicable contrast criteria. Do not use gold for low-contrast essential body text.

Bundle licensed font files and fallbacks in the signed application package. Use Source Serif 4 or an approved equivalent for large headings, Inter or an approved equivalent for UI, and system monospace for technical values. Serif titles use restrained scale and no swashes. Incident names wrap rather than truncate essential identification. Support font-loading failure without layout-breaking shifts.

Build reusable IncidentHeader, SaveStatus, ScopeRegister, Timeline, TaskList, ChannelPanel, EvidenceRegister and HealthBanner components. Server authorization remains authoritative even if the client hides controls. Provide text labels for every critical icon, logical focus order, modal focus management and linked error summaries. Announce update counts politely without continually reading full chat streams. Preserve a reader’s scroll position when new messages arrive.

Target WCAG 2.2 AA, including keyboard operation, screen-reader semantics and accessible status messages. Product controls target 44 × 44 CSS pixels. Test 200% zoom and 320 CSS pixel reflow, with explicit exceptions only for inherently two-dimensional tables. Respect reduced motion; no decorative entrance animation during incident work. A focus view removes decorative spacing before reducing text size.

## 10 Capacity and operational observability

Initial sizing assumption: primary and recovery nodes each provide 8 CPU cores, 32 GiB RAM and 1 TiB encrypted SSD storage. Treat this as a starting point for load testing, not verified sufficiency. Reserve space for database growth, evidence, quarantine, exports and temporary scanning; alert at 70%, 85% and 95% disk use. At critical capacity reject new attachments before exhausting storage reserved for text, audit and recovery operations.

Measure the PRD latency targets at 100 connected users, 10 active incidents, 20 accepted mutations per second for a 15-minute peak, one million existing events and 100 GiB evidence. Exclude bulk transfer duration from ordinary API latency; report upload throughput separately. Run an eight-hour soak at representative lower load and document CPU, memory, queue depth and database growth.

Expose enclave-local metrics for request latency, errors, authorization failures, connected clients, outbox lag, scan queue, disk, backup age, checkpoint age, certificate expiry and clock drift. Alerts appear in System health and on the local operator console. No external telemetry is required. Record UTC time uncertainty; warn at more than two seconds deviation from the trusted local time source. Sequence numbers remain authoritative for commit order when clocks differ.

## 11 Secure development and release controls

Use code review, locked dependencies, reproducible build procedures where feasible, signed packages, software bills of materials and automated vulnerability and secret scanning. Verify package signatures against an independently provisioned root before offline import. Reject rollback to known vulnerable builds unless a separately approved recovery procedure requires it. Ship local health checks, setup instructions and recovery runbooks with the package.

Enforce a restrictive Content Security Policy, no framing, MIME sniffing protection, explicit download content disposition, request size limits and safe output encoding. Disable unnecessary host services, prohibit application container root privileges and separate worker credentials from application credentials. Maintain independent administrator workstations and an inventory of keys and devices.

Updates require a verified backup, a migration dry run against a restored copy and an explicit rollback or forward-repair plan. Schema changes preserve older records and audit meaning. Do not apply an untested update during an active incident unless its risk is accepted by the commander and security lead.

## 12 Verification and release gates

| Test | Method and passing condition | PRD mapping |
|---|---|---|
| Isolation | Block internet and corporate services; run enrollment, incident, scope, messaging, export and restore; packet capture shows no unauthorized egress | NF01, AC01 |
| Authorization | Exercise every API, subscription, search and download across roles, incidents and restricted channels; no cross-scope disclosure | AC02–03, CO01 |
| Revocation | Suspend user and device with active requests and sockets; access stops within five seconds on healthy enclave | AC03 |
| Concurrency | Submit conflicting revisions and duplicate message retries; no lost update or duplicate durable message | IR03, CO02 |
| Evidence | Test hostile HTML, disguised files, archive bombs and oversized uploads; no application execution or resource exhaustion | EV01 |
| Integrity | Modify database history and delete events in a test copy; external checkpoint comparison detects tampering and signals gaps | NF07 |
| Resilience | Kill workers and primary host; validate outbox replay, fenced recovery, RPO and RTO with consistent attachment manifests | NF03 |
| Scope correctness | Locked and exfiltrated coexist; recovery does not clear exposure; unknown and overlapping counts stay explicit | SC01–03 |
| UX and accessibility | Run PRD first-use study, manual keyboard and screen-reader flows, contrast, zoom and reflow checks | NF04–06, UX01–04 |
| Capacity | Run the stated peak and soak profile; meet p95 targets and maintain bounded queues | NF02 |
| Export and retention | Check redaction, approval, expired download, CSV safety, hold and scheduled purge against backups | RP01 |

Release requires all P0 tests passing, independent penetration testing with no unresolved critical or high exploitable findings, a clean-device deployment rehearsal and a successful restore. Automated checks alone do not certify security or accessibility. The security lead owns threat acceptance; the incident response lead owns operational rehearsal; the design lead owns stress usability; engineering owns test evidence and reproducibility.

## 13 Implementation sequence and decision register

1. Establish enclave hardware, trusted clients, local DNS and certificates, independent identity, custodians and reproducible signed installation.
2. Implement authorization, audit transaction boundaries and revisioned incident and scope schemas before adding live collaboration.
3. Add tasks, decisions, outbox delivery, reconnect behavior and channels, with hostile-input and permission tests.
4. Add evidence quarantine, controlled export, legal hold, retention and independent recovery.
5. Complete visual refinement, usability research, penetration testing, capacity validation and operational handoff.

The chosen modular architecture avoids distributed-write complexity while retaining separate trust boundaries for identity, scanning, audit and recovery. Server-readable collaboration enables search, review and controlled export; end-to-end encryption is not claimed. Air-gapped operation means connected local collaboration without internet, not collaboration between physically disconnected clients.

Deployment decisions still needing organizational approval are hardware procurement, retention periods, data residency, custodians, approved font licenses and whether off-site disaster recovery is required. These are explicit rollout decisions; the requirements and default behavior above remain a complete proposed baseline.

## 14 Reference basis

NIST SP 800-61 Rev. 3 informs the response and continuous-improvement approach; it does not prescribe this application architecture or make the product compliant by association. WCAG 2.2 informs accessibility targets. Security controls in this TRD are engineering requirements that require implementation and testing.

- NIST SP 800-61 Rev. 3: https://csrc.nist.gov/pubs/sp/800/61/r3/final
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C Contrast Minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Companion PRD and the three supplied visual references are the product and aesthetic authorities.

References checked 7 November 2026.