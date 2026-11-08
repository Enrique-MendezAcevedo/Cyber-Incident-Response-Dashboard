# Cyber Incident Response Dashboard
## Product Requirements Document

**Version:** 1.0 · **Date:** 7 November 2026 · **Status:** Proposed implementation baseline  
**Audience:** Product, design, engineering, security, incident response and evaluation teams  
**Working product name:** Aegis Command

## 1 Purpose and product decision

Build an independently secured command center where an authorized response team can establish a shared incident record, determine the extent of compromise, coordinate work and communications, and preserve the decisions needed for recovery and review. The organization’s ordinary systems, accounts, networks and endpoints must be treated as compromised.

The experience will combine the supplied references’ luxury typography with the clarity required in a crisis: expressive serif headings, warm ivory surfaces, near-black text, fine dividers and restrained brass accents. Operational information will use readable sans serif typography. Visual restraint must improve scanning rather than hide critical information.

This document defines product behavior and acceptance criteria. The companion TRD defines its implementation and verification. Requirements marked P0 are mandatory for the MVP; P1 items follow after the security and usability gates pass. Numeric targets are proposed product targets, not measured results.

## 2 Goals and boundaries

The MVP must work when corporate SSO, email, DNS, collaboration tools and internet access are unavailable or unsafe. It must support administrator-controlled enrollment, structured incident records, live status updates, explicit compromised-data scope, incident communications, evidence references and an exportable review record.

The product does not detect or remediate malware, execute commands on production systems, negotiate ransomware, automatically determine legal notification duties, or guarantee confidentiality on an attacker-controlled endpoint. A responder kit and independently administered enclave are prerequisites. A VLAN on corporate infrastructure alone is insufficient.

Initial deployment serves one organization, up to 100 concurrent users, 10 active incidents and 1 million combined timeline, message and audit events. The MVP supports text communications and controlled evidence uploads. Video calls, external integrations, public status pages, native mobile applications and simultaneous disconnected multi-site editing are excluded.

## 3 Users and authority

| Role | Primary need | Authority |
|---|---|---|
| Platform administrator | Establish trusted access and maintain service | Enroll or suspend users and manage devices; no incident content access by default |
| Incident commander | Coordinate priorities and approve state changes | Manage assigned incident membership, severity, decisions, closure and reopening |
| Responder | Investigate and document findings | Update assigned incident records, scope, tasks and messages |
| Evidence custodian | Preserve material and custody history | Accept, release and export evidence within assigned incidents |
| Communications lead | Prepare consistent updates | Draft and approve internal briefings; external distribution occurs outside MVP |
| Observer or executive | Understand impact and decisions | Read assigned incident summaries; restricted records require separate grants |
| Auditor | Review integrity and process | Read specifically assigned audit and review material; no operational edits |

Roles can be combined through explicit grants. Platform membership never implies incident membership. Restricted channels and evidence inherit narrower access grants. Infrastructure operators remain a privileged trust dependency, addressed in the TRD.

## 4 Core journeys

### Activate the command center

An administrator uses a prepared clean device and independent network to start the enclave, verify its health, and authenticate using a pre-enrolled hardware key. They verify responders through a separate trusted channel or in person, enroll their clean devices, and grant minimum incident access. The start screen shows connectivity, identity and backup health without suggesting that these indicators prove the environment is uncompromised.

### Declare and coordinate an incident

The commander selects **Create incident**, enters a title, severity, owner and initial observation, and receives a timestamped incident ID. Unknown details remain explicitly unknown. The Overview presents current impact, the next actions, decisions needed, unresolved scope questions and the latest confirmed update. Responders record findings and assign tasks while authorized participants receive live updates.

### Define the compromised data

A responder adds a dataset or affected asset, its owner, category, estimated volume and confidence. They can record ransomware locking and suspected exfiltration simultaneously. Evidence references explain the assessment. Each change retains the previous assessment and its time, author and rationale. The commander can distinguish confirmed impact from suspected impact without mistaking missing information for safety.

### Hand over and recover

The outgoing team generates a checkpoint containing confirmed facts, open hypotheses, outstanding tasks, pending decisions and changes since the prior shift. The next team acknowledges the handover. The commander moves the incident through recovery, records validation evidence, and closes it with a review owner. Subsequent findings reopen the incident with a reason; the earlier record remains intact.

## 5 Functional requirements

### Trusted access

**P0 AC01 — Independent enrollment.** Administrators create named users without corporate email or SSO. Enrollment requires identity verification, a short-lived single-use invitation, a hardware-backed authentication credential and an approved clean device. Invitations expire after 30 minutes by default. Creating an invitation alone grants no access.

**P0 AC02 — Least privilege.** Every user receives explicit role and incident grants. New administrators require approval by two existing authorized custodians after initial bootstrap. The UI shows effective permissions before confirmation. Incident commanders cannot create platform administrators.

**P0 AC03 — Revocation and recovery.** Suspension terminates active access within five seconds on a healthy enclave. Recovery uses two custodians and re-verification; corporate email and SMS are not recovery mechanisms. Lost-device procedures revoke both device and user sessions. Emergency access is named, time-limited and audited.

### Incident documentation

**P0 IR01 — Structured record.** Capture ID, title, severity and rationale, commander, discovery time, reported time, timezone, source, summary, business impact, affected services, incident category, current phase and next review. Additional sections record observations, hypotheses, indicators, actions, decisions, communications, evidence and recovery validation. An unknown value has an owner and a follow-up task when material.

**P0 IR02 — Lifecycle.** Supported states are Declared, Investigating, Containing, Recovering and Closed. These are product workflow states, not a prescribed standards taxonomy. Activities can overlap. Backward transitions require a reason. Closure requires a commander, impact summary, unresolved-risk disposition, recovery validation, review owner and due date. Reopening creates a new transition event.

**P0 IR03 — Accountable updates.** Every saved change records author, server time and version. Users can correct a record through a new version, but cannot silently erase history. Concurrent edits display a comparison instead of silently overwriting one another. Save status distinguishes pending, saved, failed and conflicting changes.

**P0 IR04 — Tasks and decisions.** Tasks include owner, priority, due time, status and linked incident or scope item. Decisions include decision maker, rationale, alternatives considered and evidence references. Decisions can be superseded with a reason. Destructive infrastructure actions occur outside this product.

### Scope and data exposure

**P0 SC01 — Scope register.** Each row records an asset or dataset identifier, business owner, environment, data category, sensitivity, geography if known, estimated count or range with unit, assessment time, assessor, confidence, evidence links and remediation owner. Prefer metadata and references over importing sensitive source records.

**P0 SC02 — Independent impact dimensions.** Confidentiality is Unknown, Suspected exposure, Confirmed exposure or No evidence found as of a stated assessment. Availability is Unknown, Accessible, Degraded, Locked or Unavailable. Integrity is Unknown, Suspected alteration, Confirmed alteration or Verified against a named baseline. Exfiltration is separately Unknown, Suspected, Confirmed or Not observed. Containment and recovery have separate progress states. None of these dimensions automatically proves another.

**P0 SC03 — Honest aggregation.** Summaries separate confirmed and suspected totals. Counts use explicit units and show unknown coverage. Potential overlaps are flagged; totals across overlapping datasets are not summed unless a documented deduplication method exists. Recovered data may still be exposed or exfiltrated.

### Communication and evidence

**P0 CO01 — Incident channels.** Each incident has a persistent general channel and optionally restricted channels. Support threads, mentions, pinned instructions, unread indicators and explicit acknowledgments for critical messages. Acknowledgment means the user clicked Acknowledge; delivery and read indicators are not substituted for it.

**P0 CO02 — Reliable messages.** A message becomes Sent only after durable server acceptance. Reconnecting users receive missed messages without duplicate submissions. Corrections preserve revision history. Permission changes apply to channel access, notifications and search. The MVP provides no private direct messages, simplifying incident record retention.

**P0 EV01 — Evidence register.** Capture source, collector, collection time, server receipt time, hash algorithm and digest, description, custody events, classification and storage reference. Attachments remain quarantined until approved for safe access. The product records provenance but does not claim a hash proves the truth or legal admissibility of evidence.

**P0 RP01 — Review and export.** Generate an incident report with timeline, scope, decisions, tasks, communications and evidence manifest. Export permission is distinct from read permission. A full sensitive export requires a second authorized approver; summaries can use a pre-approved redaction policy. Exports carry classification, creation time, scope, redactions and verification hashes. Legal hold blocks scheduled deletion.

## 6 Information architecture and luxury typography

Primary navigation is **Incidents, My tasks, People and System health**. Within an incident use **Overview, Timeline, Scope, Tasks, Communications, Evidence and Review**. Keep the incident title, severity, commander, lifecycle state, connection state and last successful sync visible in the incident header.

At desktop widths, Overview uses a dominant situation summary, a compact next-actions column and a chronological update area. The communication panel can dock beside the work area without hiding the primary record. At narrow widths, stack the same content in priority order and show one work surface at a time. Long scope tables receive a labeled horizontal scroll region and a row-detail view.

| Design element | Specification | Operational guardrail |
|---|---|---|
| Display typography | Editorial high-contrast serif; suggested family Source Serif 4, with Georgia fallback | Page titles 32–40 px; no display serif in controls, status chips or dense tables |
| UI typography | Humanist or neutral sans serif; suggested family Inter, with system sans fallback | Body 16 px, secondary and tables at least 14 px; clear numeral shapes |
| Technical values | System monospace | Hashes, IDs and timestamps; wrapping and copy controls |
| Canvas | Warm ivory #F5F1E9; surfaces #FFFDFA | No image backgrounds behind operational text |
| Primary ink | #191917; secondary #59564F | Verify rendered contrast on every supported surface |
| Brass accent | #82652F | Selection and decorative emphasis; never the sole severity cue |
| Dividers and spacing | Fine rules, 8 px spacing rhythm, 24–32 px panel padding | Essential control outlines remain clearly visible |
| Status | Labeled icons plus semantic red, amber, blue or green | Color alone never communicates state; green cannot mean an asset is proven safe |

The reference images inform hierarchy, whitespace, elegant serifs and subdued materials. Their tiny letter-spaced copy, decorative scripts, oversized poster compositions and photography are inappropriate for critical controls. Use modest tracking only for short noncritical labels. Do not reproduce the pictured commercial font names or assume font licenses. Bundle approved fonts locally after license review.

Target WCAG 2.2 AA. Normal text must achieve at least 4.5:1 contrast and large text at least 3:1. Controls use 44 × 44 CSS pixel targets as a product target. Provide visible keyboard focus, semantic landmarks, labeled fields, inline errors, a non-disruptive live-update summary, reduced motion and 200% zoom support. At 320 CSS pixels, ordinary content reflows; genuinely two-dimensional data may scroll within its own labeled region.

## 7 Stress usability and creative additions

**P0 UX01 — First five minutes.** Show three obvious actions: Create incident, Join assigned incident and View my tasks. Forms begin with essential fields and progressively reveal detail. Examples and explanations appear beside fields. Do not require a tutorial, hidden gestures or memorized shortcuts.

**P0 UX02 — Focus view.** A one-click focus view prioritizes severity, next actions, pending decisions and communication. It reduces visual decoration without removing context, security warnings or save indicators. Emergency actions use explicit labels and targeted confirmation rather than repeated generic dialogs.

**P0 UX03 — Confidence ledger.** Confirmed facts and hypotheses remain visually distinct. Every hypothesis has an owner, supporting or contradicting evidence and a review time. This improves decisions when evidence is incomplete.

**P0 UX04 — Shift checkpoint.** Produce a deterministic handover from recorded changes and unresolved work; a person reviews it before publication. It requires no external AI service.

**P1 — Incident replay and rehearsal.** Reconstruct past states for review and support synthetic tabletop exercises in a visibly separate environment. Later features may include controlled external briefing generation and separately hosted recovery enclaves. No feature may silently enable outbound connectivity.

## 8 Nonfunctional and success criteria

| ID | Requirement and measurement |
|---|---|
| NF01 Security independence | Complete the core exercise with corporate identity, DNS, email and internet blocked; unauthorized corporate devices cannot connect |
| NF02 Performance | At the stated load, p95 ordinary reads under 1 second, writes under 1.5 seconds and committed updates visible to connected recipients within 2 seconds |
| NF03 Continuity | Target 99.9% service availability during a measured 30-day exercise, including maintenance; recovery point at most 5 minutes and restore within 60 minutes under the defined disaster scenario |
| NF04 Usability | In a study of at least 10 representative first-time users, 90% create a valid incident within 3 minutes and update a scope item plus acknowledge a message within 2 minutes, without coaching |
| NF05 Comprehension | At least 90% identify severity, next owner and data freshness within 30 seconds; no participant interprets an unsaved change as saved |
| NF06 Accessibility | All critical workflows pass keyboard and screen-reader review, contrast checks, zoom and reflow tests; no unresolved critical accessibility defect |
| NF07 Integrity | Every accepted mutation is attributable and versioned; tampering exercises detect altered checkpoints or missing audited events within the monitoring interval |

Availability excludes loss of both primary and recovery hardware from the normal service target; the disaster recovery target covers that defined failure. Full site destruction requires a separately located copy and a separate recovery plan. All metrics are release gates to be tested, not service guarantees already achieved.

## 9 Acceptance scenarios and traceability

| Scenario | Expected result | Requirement coverage |
|---|---|---|
| Corporate administrator credentials are stolen | They grant no platform access; access attempts are recorded without revealing incident data | AC01–03, NF01 |
| Two responders edit the same scope record | One revision commits; the other sees a conflict with recoverable input | IR03, SC01–03 |
| Ransomware data is both locked and exfiltrated | Both conditions remain visible after recovery changes availability | SC02 |
| Network disconnect occurs during a message send | UI indicates uncertain or pending delivery; retry produces one durable message | CO02 |
| An incident member is suspended while viewing a restricted channel | Access and live delivery stop within five seconds on the healthy enclave | AC03, CO01 |
| User uploads an HTML or malicious document attachment | It cannot execute in the dashboard and remains quarantined | EV01 |
| Commander closes and later reopens an incident | Closure checks are enforced and both transitions remain in history | IR02, RP01 |
| First-time team works without a tutorial | Completion and comprehension meet NF04–06 | UX01–04 |

## 10 Delivery stages and launch decision

Stage 1 establishes the threat model, independent identity and device access, approved design tokens and a tested clean-device deployment. Stage 2 delivers incident records, scope, tasks, channels and audit capture. Stage 3 delivers evidence quarantine, exports, handovers and recovery procedures. Stage 4 performs penetration testing, compromised-network exercises, accessibility assessment and first-use research.

Launch requires all P0 acceptance criteria, a successful restore drill, no unresolved critical or high exploitable security findings, and approval from the product owner, security lead and incident response lead. Schedule and budget are intentionally not asserted without team and infrastructure estimates.

Before deployment, those owners must select hardware, approve retention and legal-hold policy, verify font licenses, appoint custodians, and confirm the independent access network. Defaults in the TRD make the design implementable; policy choices require organizational signoff rather than hidden assumptions.

## 11 Standards and references

The incident model is informed by NIST SP 800-61 Rev. 3 and CSF 2.0. Revision 3 integrates incident response with cybersecurity risk management and supersedes Revision 2. These documents provide guidance rather than certification of this product. The detailed fields and workflow in this PRD are product requirements, not a claim that NIST mandates this exact schema.

- NIST, *SP 800-61 Rev. 3*, April 2025: https://csrc.nist.gov/pubs/sp/800/61/r3/final
- W3C, *WCAG 2.2*: https://www.w3.org/TR/WCAG22/
- W3C, *Understanding Contrast Minimum*: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Visual direction: three user-supplied luxury typography reference images in this conversation.

References checked 7 November 2026. No legal compliance or independent security certification is claimed.
