---
name: lifecycle-remediation
description: Use when the user asks how a technical SEO finding changed across saved audits (lifecycle history of a page or rule), what remediation work is saved for a finding, or how to read the producer availability of stored audit events and operational episodes. Capability-gated by tool discovery; read-only.
---

# Lifecycle, remediation and event availability (profile 1.4.0)

This skill is Codex-specific and is not part of the shared pinned skill set. It covers
contract profile 1.4.0: three owner-scoped stored reads and the extended `availability`
codes of the 1.3 audit reads. It adds no write path. Saving remediation work and recording
verification attempts stay in the web dashboard. Every call here reads stored data only: it never
starts a crawl, provider collection or event processing.

## 1. Discover first, never assume

Discover tools and input schemas in the current session before offering any of this.

| Tool | Purpose | Inputs |
| --- | --- | --- |
| `website_audit_lifecycle` | One rule on one entity across saved audits | `website_id`, `entity_id`, `rule`, optional `limit` 1–100 (default 50), paired `before` + `before_id` |
| `website_url_lifecycle` | All rules for one entity across saved audits | `website_id`, `entity_id`, optional `limit` 1–100, paired `before` + `before_id` |
| `website_remediation_list` | The saved remediation work item for one finding, with its newest verification attempts | `website_id`, `delivery_id`, `finding_index` (≥ 0), optional paired `before` + `before_id` |

- A tool that is **not listed** is `unsupported`. Say the feature is unavailable on this connection.
  Never substitute another operation, never answer from `website_audit_detail` as if it were the same,
  and never report an empty history or a zero count.
- A listed tool is not proof the feature is on. Each read has its own rollout flag in the deployed API.
- Take `entity_id`, `rule`, `delivery_id` and `finding_index` from saved audit history or detail the user
  already has. Do not invent them. A website ID you are given is never authorization; HTP decides ownership.

## 2. Paging

Follow `next_cursor` with **both** `before` and `before_id` exactly as returned, keeping `website_id`
(and `entity_id`/`rule`, or `delivery_id`/`finding_index`) fixed. Supplying only one cursor part is invalid
(`invalid_cursor_or_limit`). Stop when `has_more` is false and `next_cursor` is null. State plainly when you read
only the first page of a longer history. Lifecycle items omit evidence values; do not claim the values
are unchanged or changed from lifecycle alone, read the saved audit detail for evidence.

`website_remediation_list` returns one work item per finding. Its `next_cursor` pages that item's verification
attempts, not other findings. An unsaved finding yields `items: []`. That means no work has been saved for it
and says nothing about whether the finding is real, fixed or resolved.

## 3. Errors are never empty results

Preserve the `code`, the HTTP `status` and the sanitized `error` text:

| Code | Meaning and action |
| --- | --- |
| `auth_required` | Missing, expired or anonymous sign-in. Ask the user to reconnect with `codex mcp login htp`; it is not an empty result. |
| `forbidden` | Not the current owner of that website and FQDN. Stay denied. Do not infer that the data is absent. |
| `invalid_cursor_or_limit` | Limit outside 1–100 or an unpaired cursor. Correct the inputs and retry once. |
| `unavailable` (status 503) | The rollout flag is off in the deployed API, or the store is unreachable. This is **not** an empty history, **not** an empty work queue and **not** proof that nothing exists. Report it as held or unavailable and stop. |
| `unsupported` | The tool is absent. Say so; do not substitute. |

## 4. Producer availability for audit events and episodes

`website_audit_events` and `website_operational_episodes` (see `website-management`) report `availability`
and a `producer` object. Under profile 1.4.0 the codes are:

| Code | Reads | Meaning |
| --- | --- | --- |
| `producer_unavailable` | events, episodes | Processing is disabled. Events are not being produced. |
| `producer_not_enqueuing` | events | Processing is on, enqueueing is off. New events are not queued. |
| `producer_starting` | events | Enabled, but the runner has not run yet. |
| `producer_stale` | events | The runner has not run for 5 minutes. |
| `producer_degraded` | events | The last run hit transient errors, or a job is held as `processor_unavailable`. |
| `producer_active` | events, episodes | The runner is running normally. |

- Only `producer_active` lets you read an **empty** page as "no events" or "no episodes". Every other code
  means events may be missing or delayed. Say that and show the code. An empty page is never a zero count of
  site issues.
- If `availability` is a code you do not recognise, treat it like a non-active code and report it as reported.
- Show `producer.pending`, `producer.held` and `producer.held_by_reason` as the producer's counts for this site. When
  `counts_capped` is true they are lower bounds. The producer object describes the producer, not the history.

## 5. Report honestly

Name the website, entity or finding you read, the number of pages followed and whether more remain. Say when a
result is held, unsupported or partial. Never present a held, denied or unsupported read as a clean result, and
never advise that a finding is fixed on the strength of an empty lifecycle or an empty remediation list.
