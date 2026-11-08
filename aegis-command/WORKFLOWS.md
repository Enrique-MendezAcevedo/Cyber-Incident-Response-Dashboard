# Incident documentation and scope — release 1.0.0

This guide describes incident/scope workflows, retaining the independent security controls introduced in 0.2.0. Release 1.0 also supplies evidence metadata/custody and encrypted originals, approved HTML/JSON/CSV reports, lessons/action tracking and consistent encrypted backup/restore. See DEMO.md for the complete rehearsal and VALIDATION.md for measured coverage and remaining operational gates.

## Declare and coordinate an incident

1. Sign in with your security key. Administrators and existing incident commanders can select **Create incident** from the header or incident list. Responders and observers cannot promote themselves by creating an incident.
2. Enter the title, severity/rationale, responsible commander and initial situation summary. The detailed section accepts discovery and report times, detection source, category, business impact, affected services, clock uncertainty, timezone and next review. Time controls use UTC explicitly; the API also accepts and preserves explicit offsets. A separate authoritative server receipt time records when information entered the platform.
3. Select **Synthetic exercise incident** only for a rehearsal. Real incidents have their own UUID, readable incident code and response-enclave label. The original sample remains visibly synthetic.
4. The chosen commander receives explicit access. A platform administrator who chooses another commander gains no incident-content access. Administrators can manage assignments by incident ID, with unassigned titles shown as restricted. In **People**, select the incident before granting existing users access or creating an incident-bound invitation. Changes invalidate the affected person's sessions.
5. Use **Record** to document findings, indicators and actions. Separate observations, confirmed facts and hypotheses. Supply a source, event time or unknown-time explanation, responsible owner and references. Open hypotheses need a review time. Confirmed facts require supporting references. Corrections create new revisions and preserve earlier content.
6. Use **Tasks** to assign an owner, priority, due time, status and optional scope link. Only the task owner or a commander can update an existing task; only a commander can reassign it. Completion requires the action taken or evidence; cancellation requires disposition. **My tasks** collects your assigned work across incidents you can currently access.
7. Commanders record decisions with a decision maker, rationale, alternatives, evidence and review time for pending decisions. Supersession links a replacement decision in the same incident and records a reason. Existing decisions cannot be silently erased.

Unknown discovery, impact, source, category or affected services create one assigned documentation follow-up task. Filling in the fields completes that task with its history intact. This keeps an empty initial field distinct from a confirmed absence of impact.

## Lifecycle, closure and review

Product states are **Declared, Investigating, Containing, Recovering and Closed**. They are coordination states; response activities may overlap. A commander supplies a reason for every transition, including backward transitions.

Closure is allowed from **Recovering** and requires an active responsible commander, final impact summary, unresolved-risk/work disposition, recovery validation evidence, and an assigned review owner and due time. Open work is not silently marked complete at closure; its disposition belongs in the closure record. Record validation evidence rather than treating a phase label as proof that infrastructure is safe.

Closed incidents reject operational record, scope, task, finding and decision mutations. Assigned responders can continue incident communications, and the review owner or a commander can document the scheduled review; commanders can publish a reviewed handover. Completing a review requires notes. Reopening requires a commander and reason, returns the incident to **Investigating**, and preserves the earlier closure and review in history. Reclosing begins a new review cycle without erasing the preceding one.

## Document compromised assets and datasets

In **Scope → Add asset or dataset**, enter:

| Area | Captured information |
|---|---|
| Identification | Dataset/asset type, stable identifier, name, business/data owner, environment, data category, sensitivity and geography if known |
| Quantity | Lower/upper bounds and explicit units; equal bounds mean an exact count; both blank mean unknown |
| Uncertainty | Confidence, rationale for unknown metadata/quantity, potential overlap group, assessor and assessment time |
| Responsibility | An active assigned remediation/follow-up owner |
| Support | Evidence/source references, integrity baseline when verified, recovery validation when validated |
| Independent impact | Availability, confidentiality/exposure, exfiltration, integrity, containment and recovery |

Confirmed exposure or exfiltration requires an evidence reference. Verified integrity requires a named baseline. Validated recovery requires validation evidence. References are inert text, not uploaded files or automatically fetched links. A reference alone does not prove a conclusion's truth.

Unknown quantities stay null and never become zero. Counts in records/accounts/files/devices/bytes must be whole numbers; non-count units can use decimal estimates. Estimates require both ordered numeric bounds or both unknown. Totals show scope-item counts separately for confirmed, suspected and unknown exposure. Dataset quantities are never summed into a misleading unique-record total, even when an overlap label is absent. Mark known potential overlaps with a shared group label.

Changing availability to Accessible or recovery to Validated does not clear exposure or exfiltration. Scope changes record a fresh assessment rationale, authenticated assessor, assessment time and server receipt time, and retain the previous assessment. Unknown impact or metadata produces an assigned scope follow-up task; resolving the unknowns completes it, and archival cancels it with a retained disposition. The next incident review supplies its initial due time.

Use search and the Active, Confirmed exposure, Unknown quantity or Archived filters. Archive a duplicate/out-of-scope item through its edit form with a reason; it remains in history and is excluded from active counts. Unarchiving checks the identifier for conflicts with other active items.

## Collaboration, conflicts and persistence

- Connected browsers poll incident snapshots every 1.5 seconds and refresh the assigned-incident list periodically. The connection state and last successful sync remain explicit. This is enclave-local collaboration without an internet service.
- Metadata, scope, tasks, findings, decisions and reviews have independent revisions. Ordinary chat and unrelated scope changes do not force a metadata edit conflict. Each accepted incident mutation also advances a sequence and records an authenticated timeline/audit event.
- Saving succeeds only after the encrypted vault transaction commits. Retries reuse the submission ID; reusing an ID for a different command is rejected. A stale revision returns HTTP 409 and the currently authorized record. The dialog preserves your draft, compares it with saved values, and replaces it only when you explicitly choose **Load current version** and confirm.
- Scope/entity IDs from another incident are rejected. Every read, mutation, export and membership change checks the selected incident's grants. A global platform role does not bypass content grants.
- Unsaved input stays in browser memory. It is not stored in localStorage, a service worker or an external draft service. Access loss clears the visible workspace. Previously viewed or manually copied information cannot be retracted.

## Upgrade existing 0.2.0 vaults

The encrypted vault schema advances from 1/2 to 3 in the existing transaction boundary. Schema 3 adds evidence-register, report and lesson collections without resetting existing incident content. The single prior incident becomes a keyed incident collection; existing messages, events, scope status, task completion, memberships and prior scope revisions are preserved. Legacy quantities are converted from the original exercise's known formats; unknown counts remain null. Missing legacy assessor/receipt metadata remains explicitly unknown. The sample's original discovery/declared times and synthetic classification remain explicit.

The first successful write commits the migrated vault with a schema-migration audit event. Authentication/session and encryption-key formats are unchanged. Before upgrading a deployed enclave, stop the old service, retain its encrypted vault and separately controlled key under the custodian procedure, and rehearse the upgrade on a copy. After schema migration, 0.2.0/0.3.0 are not supported readers; use the pre-upgrade copy for a controlled rollback rather than opening the upgraded vault with old code. Plaintext files from the original unauthenticated ZIP are still not auto-imported.

## Documentation guidance traceability

The mapping below describes application support, not certification or a claim that NIST prescribes these exact fields. The five product phase names are application choices. See [NIST SP 800-61 Rev. 3, Table 3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf) and the [publication record](https://csrc.nist.gov/pubs/sp/800/61/r3/final).

| Guidance reference | Application support |
|---|---|
| RS.MA-01, RS.MA-02, RS.MA-03 | Named commander, declaration, severity/rationale, category, impact and triage review |
| RS.MA-04 | Current incident status, assigned tasks, priorities and next review |
| RS.AN-03, RS.AN-06 | Findings, actions, source/event/receipt times, corrections and attributed histories |
| RS.AN-08 | Asset/data scope, estimates, uncertainty and reassessment |
| RC.RP-05, RC.RP-06 | Recovery-validation references, explicit closure criteria and retained closure documentation |
| ID.IM-03 | Assigned review with notes and follow-up tasks |

Evidence metadata, custody, encrypted quarantine and a generated after-action report are implemented in release 1.0. This mapping itself is not certification. Automatic malware scanning, independently anchored audit collection, recipient-key export encryption and policy-based redaction remain outside this hackathon profile; see VALIDATION.md.

## Verification

`npm test` covers migration, declaration retries, unknown follow-ups, record versions, scope validation and overlap, stale concurrent revisions, task ownership, finding corrections, decision supersession, closure/review/reopening, and incident isolation, alongside the existing TLS/WebAuthn controls.

`npm run test:browser` uses two separately authenticated browser contexts and test-only virtual keys to complete the workflows through the actual forms, including a real concurrent-edit comparison, cross-incident denial, live updates and mobile scope layout. It checks JavaScript errors and external page requests. It is not a physical-network isolation assessment or a usability study with first-time responders.
