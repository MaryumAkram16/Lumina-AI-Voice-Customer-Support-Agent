# Lumina Voice Agent Setup Guide

This guide takes a new operator from an empty provider workspace to a controlled test call. It assumes the operator will use their own Retell AI, n8n, Google Cloud/Sheets, and model-provider accounts. Provider subscriptions, API credits, domains, and production data are not included.

> **Safety rule:** Complete the workflow test with synthetic sample orders before connecting a production order system or accepting real customer calls.

## 1. Architecture and responsibilities

Lumina uses Retell for the voice interaction, n8n for orchestration and business logic, Google Sheets as the reference order data source, and a model provider for post-call analysis. The repository contains the workflow export and Retell agent configuration; it does not contain provider credentials.

| Component | Operator action | Test success condition |
|---|---|---|
| Retell AI | Create or import the voice agent and configure the custom LLM/tools | A test call can reach the configured endpoint |
| n8n | Import the workflow, connect credentials, activate the production webhook | A webhook execution appears with a successful response |
| Google Sheets | Create a test sheet and share it with the service account | A known sample order is returned correctly |
| Model provider | Configure the provider credential used by post-call analysis | A completed call produces structured analysis or a documented safe failure |

## 2. Prerequisites

Before starting, prepare the following:

1. An n8n Cloud or self-hosted instance that can receive HTTPS requests.
2. A Retell AI account with permission to create an agent and configure a custom LLM.
3. A Google Cloud project with Google Sheets API access and a service account.
4. A model-provider credential required by the imported post-call analysis workflow.
5. A clean test Google Sheet containing only synthetic order records.
6. This repository cloned locally.

```bash
git clone https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent.git
cd Lumina-AI-Voice-Customer-Support-Agent
cp .env.example .env
```

Never commit `.env`, service-account JSON, private keys, or provider credentials. The repository ignores these files by default.

## 3. Configure the test environment

Fill in `.env` locally. The values below are names and examples; use the credentials and identifiers from your own accounts.

```dotenv
LUMINA_N8N_WEBHOOK_URL=https://your-n8n-host.example.com/webhook/retell
RETELL_API_KEY=replace-with-your-retell-key
RETELL_AGENT_ID=replace-with-your-agent-id
RETELL_ACCESS_TOKEN=replace-with-a-short-lived-test-token-if-needed
OPENAI_API_KEY=replace-if-used-by-your-workflow
GEMINI_API_KEY=replace-if-used-by-your-workflow
GOOGLE_SHEETS_DOCUMENT_ID=replace-with-test-sheet-id
GOOGLE_SHEETS_SHEET_NAME=Orders
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@example.iam.gserviceaccount.com
N8N_ENCRYPTION_KEY=replace-for-self-hosted-n8n-only
```

The `.env` file is a local reference for configuration. n8n credentials should be stored in n8n's credential system or the hosting platform's secret manager, not pasted into workflow nodes or committed files.

## 4. Create a synthetic test sheet

Create a sheet named `Orders` with these columns. Use fictional names, email addresses, phone numbers, and order IDs.

| OrderID | CustomerName | Status | Carrier | DeliveryLocation | Delivery | TrackingSteps | PhoneNo | Email |
|---|---|---|---|---|---|---|---|---|
| `ORD-TEST-001` | Alex Example | Shipped | UPS | Test City | 2026-12-31 | Label created; In transit | +1-555-0101 | alex@example.test |
| `ORD-TEST-002` | Sam Example | Processing | — | Test City | Not scheduled | Order received | +1-555-0102 | sam@example.test |

Share the test sheet with the service account email and record the document ID and tab name. Do not use a customer export for the initial test.

## 5. Import and configure n8n

1. Open n8n and import `Lumina_AI_Voice_Customer_Support_Agent..json` using **Workflows → Import from File**.
2. Review every Google Sheets node and attach your own Google credential. Do not reuse credentials from another workspace.
3. Replace any example document ID or sheet name with the synthetic test sheet values.
4. Review model-provider nodes and attach the appropriate credential in n8n.
5. Confirm that the webhook node is configured for `POST` and note the **production** URL after activation.
6. Activate the workflow. Do not use the test URL for Retell production tool calls.
7. Verify that executions appear in n8n before connecting Retell.

Set `LUMINA_N8N_WEBHOOK_URL` to the production URL for your own environment. In the Retell export, replace every `YOUR_N8N_PRODUCTION_WEBHOOK_URL` value with that same URL before importing or saving the agent configuration.

## 6. Configure Retell

1. Create a new Retell agent, or import the provided agent configuration if your Retell workspace supports the export format.
2. Set the custom LLM or webhook URL to your own n8n production webhook.
3. Replace all `YOUR_N8N_PRODUCTION_WEBHOOK_URL` placeholders in the exported configuration.
4. Confirm that tool names and parameters match the n8n workflow. The reference intents include `track_order`, `cancel_order`, `return_item`, and refund-related actions.
5. Keep the agent unpublished or restricted while testing.
6. Use a test phone number or web-call session. Do not expose the agent publicly until the failure-path checks are complete.

## 7. Run the zero-to-test-call checklist

Run these checks in order:

| Step | Action | Expected result |
|---:|---|---|
| 1 | Send a synthetic webhook request for `ORD-TEST-001` | n8n receives the request and returns a structured response |
| 2 | Ask the agent to track `ORD-TEST-001` | The agent reports the synthetic shipped status |
| 3 | Ask for an unknown order | The agent gives a safe not-found response and does not invent a status |
| 4 | Omit the order ID | The agent asks for a valid identifier or follows the documented fallback |
| 5 | End the call | The post-call workflow records structured metadata or logs a visible provider failure |
| 6 | Repeat the same event if an event ID is available | The duplicate is ignored or routed to a no-op path |

A direct webhook test can use a sample request shaped like this. Replace the URL with your own endpoint and do not run it against a production system containing real customer data. In a shell session, load the local values first:

```bash
set -a
source .env
set +a

curl -X POST "$LUMINA_N8N_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  --data '{
    "event_id": "setup-test-001",
    "order_id": "ORD-TEST-001",
    "intent": "track_order",
    "email": "alex@example.test",
    "phone_no": "+1-555-0101",
    "customer_name": "Alex Example"
  }'
```

## 8. Expected response and evidence

Keep the following evidence for the test run:

- The n8n execution ID and timestamp.
- The HTTP status and response body from the webhook test.
- A screenshot or export showing the Retell tool URL is your own URL, not the repository placeholder.
- The resulting test-sheet record, if post-call logging is enabled.
- Any provider error, timeout, or fallback observed during the test.

The response should contain structured fields such as `success`, `status`, `tracking_number`, `carrier`, and `delivery_date` when the sample order is found. Exact fields can vary with the imported workflow version.

## 9. Troubleshooting

| Symptom | Likely cause | Safe corrective action |
|---|---|---|
| Retell cannot reach the agent | Placeholder or test webhook URL remains | Replace all placeholders with the active production URL and confirm HTTPS reachability |
| n8n receives a request but returns an error | Missing credentials or invalid input fields | Inspect the execution, validate required fields, and retry only with synthetic data |
| Known order is not found | Sheet ID, tab name, headers, or permissions do not match | Recheck the test sheet and service-account sharing |
| Agent reports a status for an unknown order | Unsafe fallback or prompt behavior | Stop public testing and add a not-found guard before reconnecting the agent |
| Duplicate records appear | No idempotency key or duplicate guard | Follow `OPERATIONS.md` and add the duplicate-event branch |
| Post-call analysis fails | Model credential, quota, or payload issue | Preserve the call result, log the failure, and treat analysis as non-blocking |
| Request times out | Slow sheet query or downstream provider | Inspect node timings and use a safe timeout/fallback; do not increase limits blindly |

## 10. Rollback and cleanup

To disconnect the test deployment, deactivate the n8n workflow, remove the Retell test agent or unpublish it, revoke temporary credentials, and delete synthetic test data if it is no longer needed. If a production URL or credential was accidentally exposed, rotate it immediately and remove it from all exports, logs, screenshots, and repository history as appropriate.

## 11. Production readiness gate

Do not move beyond a private test until the operator has confirmed the checks in `OPERATIONS.md`, reviewed the disclosures in `COMMERCIAL_SCOPE.md`, configured consent and retention policies, and tested provider failure and unknown-order behavior. A successful demo call alone is not evidence that the system is production-ready.
