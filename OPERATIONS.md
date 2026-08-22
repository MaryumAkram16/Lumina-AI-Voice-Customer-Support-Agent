# Lumina Operations and Reliability Guide

This guide describes the operational controls that should be applied before Lumina is exposed to real callers. It is intentionally additive: the controls can be implemented around the existing Retell → n8n → Google Sheets flow without changing the customer-facing intent pipeline.

## Operating principle

Lumina should fail safely. It must not invent an order status, silently discard a failed request, expose provider credentials, or create duplicate business actions because a provider retried an event.

> A voice response is not proof that a downstream action completed. Record the execution result and make the outcome observable.

## 1. Health-check matrix

Run the following checks after importing or modifying the workflow. Record the timestamp, environment, workflow version, and execution ID for each check.

| Check | Method | Pass condition | Failure response |
|---|---|---|---|
| Webhook reachability | Send a synthetic `POST` request to the active endpoint | HTTP response is received within the configured timeout | Verify URL, HTTPS, activation, and network access |
| Payload validation | Send a request with the required fields | Valid input proceeds; malformed input is rejected safely | Add or review required-field validation |
| Known-order lookup | Query `ORD-TEST-001` from the synthetic sheet | Returned status matches the test fixture | Check sheet ID, tab, headers, and service-account access |
| Unknown-order behavior | Query `ORD-TEST-999` | No status is fabricated; a not-found response is returned | Stop public testing and fix the fallback path |
| Missing-identifier behavior | Omit `order_id` and provide an incomplete request | Agent asks for a valid identifier or follows the documented fallback | Review input guard and Retell tool schema |
| Provider failure | Temporarily use an invalid test credential or controlled failure path | The request is logged and receives a safe fallback | Restore credential and inspect error handling |
| Post-call analysis | Complete a synthetic call | Analysis is written, or its failure is visible and non-blocking | Check model credential, quota, and payload shape |
| Duplicate event | Repeat the same event ID | No duplicate business record or action is created | Add the idempotency guard described below |
| Secret scan | Search exports and logs for credential patterns | No API keys, service-account material, or private URLs are present | Rotate exposed secrets and remove the exposure |

## 2. Idempotency and duplicate-event protection

Third-party systems may retry a request when a response is delayed or a network connection fails. A retry must not create a second cancellation, refund, return, or post-call record.

Use a stable event identifier whenever the upstream event provides one. Suitable candidates are a provider event ID, call ID plus tool-call ID, or a generated request ID that is persisted before the business action starts. Do not use the current timestamp alone because each retry would receive a different key.

### Recommended event record

Maintain a small idempotency record in a durable store. Google Sheets can be used for a starter deployment, but a database is preferable for high-volume or concurrent workloads.

| Field | Purpose |
|---|---|
| `event_id` | Stable unique key used for duplicate detection |
| `event_type` | `track_order`, `cancel_order`, `return_item`, or refund action |
| `received_at` | First-seen timestamp |
| `status` | `processing`, `succeeded`, or `failed` |
| `response_hash` | Optional proof that a retry returns the same result |
| `completed_at` | Completion timestamp |
| `error_code` | Safe internal failure category, not a secret or raw credential |

### n8n implementation pattern

Add this guard before a state-changing action such as cancellation, return, or refund:

1. Normalize the incoming event ID.
2. Look up that ID in the idempotency store.
3. If the record is `succeeded`, return the stored response and do not repeat the action.
4. If the record is `processing`, return a safe “request is already being handled” response.
5. If no record exists, create a `processing` record before the action.
6. On success, update the record to `succeeded` and store the response.
7. On failure, update the record to `failed` with a non-sensitive error category. Decide explicitly whether a failed event may be retried.

For an initial Google Sheets implementation, use a dedicated `ProcessedEvents` tab with a unique `event_id` column. Avoid concurrent read-then-write races where possible; if the workflow can receive concurrent events, use a storage system with an atomic insert or unique constraint.

### Required test cases

| Case | Expected result |
|---|---|
| Same `event_id` sent twice after success | One business action and one completed record |
| Same `event_id` sent while processing | No second action; caller receives an in-progress response |
| Different event IDs for the same order | Each request is evaluated against the business policy; an event ID is not a substitute for authorization |
| Missing event ID | Reject, quarantine, or generate and persist a request ID before any state-changing action |
| Failed event retried | The retry policy is explicit and observable |

## 3. Failure handling

Failure handling should preserve the customer’s trust and the operator’s evidence. The agent should state when it cannot verify an order or complete an action. It should not present a guessed status as fact.

| Failure | Customer-facing behavior | Operator action |
|---|---|---|
| Unknown order | Ask the caller to verify the identifier or contact support | Record a not-found outcome without exposing sheet details |
| Missing or malformed fields | Request the missing information | Record validation failure and input category |
| Google Sheets unavailable | Explain that the order cannot be verified right now and offer escalation | Inspect provider status, execution logs, and retry policy |
| Model analysis unavailable | Complete the call outcome without analysis if safe | Queue or retry analysis separately; do not block the core response unnecessarily |
| Retell or webhook timeout | Use a short apology and escalation path | Inspect latency by node and confirm the production endpoint |
| Cancellation/refund failure | Never claim completion; say the request could not be completed | Store `failed` state and route to human review |
| Credential failure | Do not mention credential details to the caller | Disable public traffic if necessary, rotate or restore the credential, and review logs |

## 4. Observability minimum

For each request, retain only the minimum data needed to operate the system. A useful operational record contains a correlation ID, event ID, intent, outcome category, execution ID, timestamps, latency, and a redacted error category. Avoid logging full call transcripts, access tokens, API keys, service-account JSON, or unnecessary customer data.

Recommended outcome categories include `success`, `not_found`, `validation_error`, `duplicate`, `provider_error`, `timeout`, `human_escalation`, and `analysis_failed`.

Set an alert or review process for repeated provider errors, duplicate-event spikes, high timeout rates, unknown-order spikes, and failed state-changing actions. The threshold should be chosen by the operator based on traffic and business risk; this repository does not claim a universal production threshold.

## 5. Release checklist

Before each release, confirm that:

- The active Retell configuration contains the operator’s endpoint rather than a repository placeholder.
- n8n credentials are stored in the credential manager or secret store.
- The test sheet and production sheet are clearly separated.
- Unknown-order and malformed-input cases have been exercised.
- Duplicate-event handling has been tested with the same event ID.
- State-changing actions have an explicit failure and escalation path.
- Provider failures do not cause fabricated customer responses.
- Logs do not contain secrets or unnecessary personal data.
- The workflow version and rollback export are archived.
- The privacy and third-party dependency boundaries in `README.md` have been reviewed.

## 6. Rollback procedure

If a release produces incorrect responses or unsafe duplicate actions, deactivate the affected n8n workflow, unpublish or restrict the Retell agent, preserve the relevant execution IDs, and restore the last known-good workflow export. Rotate any credential or webhook secret that may have been exposed. Resume traffic only after the health-check matrix passes again.
