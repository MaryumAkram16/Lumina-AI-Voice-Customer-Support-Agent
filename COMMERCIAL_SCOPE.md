# Lumina Commercial Scope and Buyer Responsibilities

Lumina is an automation template and reference implementation for an e-commerce voice-support workflow. It is not a hosted service, a managed call center, or a legal/compliance package. This document defines the expected commercial boundary for a downloadable template or setup service.

## 1. What the template includes

The repository includes a Retell agent configuration export, n8n workflow assets, example request and response structures, Google Sheets-oriented order lookup logic, post-call analysis configuration, setup documentation, and operational guidance.

| Included | Description |
|---|---|
| Voice-agent reference configuration | A starting point for order tracking, cancellation, return, refund, and support conversations |
| Orchestration workflow | n8n workflow assets that connect the voice layer to lookup and post-call processing |
| Configuration examples | Environment-variable names, placeholders, sample payloads, and test-sheet structure |
| Operations guidance | Health checks, duplicate-event protection design, failure-path behavior, logging guidance, and release checks |
| Documentation | Setup, troubleshooting, security considerations, and adaptation guidance |

The template is intended to be modified for the buyer’s business, data model, escalation policy, brand voice, and service-level requirements.

## 2. What is not included

The buyer must provide and pay for all third-party accounts, usage, hosting, and operational services. The template does not include a hosted n8n instance, Retell minutes, model-provider credits, Google Workspace or Google Cloud charges, telephony numbers, a production database, customer-support staff, custom integrations, legal advice, or ongoing monitoring.

The repository does not promise a particular response time, uptime level, conversion rate, cost, accuracy level, or business saving. Third-party pricing, APIs, features, limits, and availability may change independently of this repository.

## 3. Third-party dependencies

| Dependency | Role in the reference implementation | Buyer responsibility |
|---|---|---|
| Retell AI | Voice interaction, speech processing, and agent configuration | Maintain an account, configure consent and call settings, pay usage fees, and review provider terms |
| n8n | Webhook intake, orchestration, business logic, and downstream calls | Host or subscribe to n8n, protect credentials, monitor executions, and maintain workflow availability |
| Google Sheets / Google Cloud | Reference order data and service-account access | Control sharing, retention, access, regional settings, and the accuracy of the order data |
| Model provider | Post-call analysis or other model-assisted processing | Supply credentials, review data-processing terms, monitor usage, and validate analysis before relying on it |
| Website or telephony channel | Optional caller access surface | Configure the client or telephony integration and protect any server-side access-token flow |

The buyer should read and accept the applicable provider agreements before sending customer information to any service. No provider credential should be embedded in Retell prompts, browser code, exported workflow JSON, screenshots, or source control.

## 4. Privacy and data handling

Lumina may process voice-call metadata, customer identifiers, order identifiers, contact details, intent, status, and post-call analysis. The buyer is the party responsible for deciding whether and how this data may be collected, processed, retained, transferred, or deleted.

The template is designed to support privacy-conscious deployments, but it is **not certified as GDPR compliant, PCI compliant, HIPAA compliant, or compliant with any other legal regime**. Compliance depends on the buyer’s jurisdiction, data flows, contracts, consent language, retention settings, access controls, provider configuration, and operating procedures.

Before production use, the buyer should determine at minimum:

- Whether callers must be informed that they are interacting with an AI system or that a call may be recorded or analyzed.
- What lawful basis, consent mechanism, or other authorization applies to each data flow.
- Which fields are necessary for order verification and which should be redacted or omitted.
- How long transcripts, audio, structured records, logs, and post-call analysis are retained.
- Which staff and service accounts can access the data and how access is reviewed.
- Whether data is transferred across regions or to model providers and whether required contractual safeguards exist.
- How a customer can request access, correction, deletion, or human assistance when applicable.
- How incidents, provider outages, incorrect responses, and unauthorized access are detected and handled.

Do not use real customer data for the initial setup. Use the synthetic records in `SETUP.md` until the data-processing and retention design has been reviewed.

## 5. Accuracy and human escalation

Voice and model outputs can be incomplete or wrong. The buyer must define which actions Lumina may perform automatically and which require human confirmation. State-changing actions such as cancellations, returns, refunds, address changes, or account changes should have an explicit authorization and escalation policy.

Lumina must not claim that an order action completed unless the downstream system confirms completion. When a lookup, provider, or business action fails, the agent should give a safe fallback and provide a human-support path where appropriate.

## 6. License and commercial use

The repository is distributed under the MIT License as shown in `LICENSE`. The MIT License permits use, modification, distribution, and commercial use of the repository, subject to its notice and warranty terms.

A seller may package and sell their own documentation, setup assistance, branding, customizations, and distribution channel. The seller must not imply ownership of third-party trademarks, provider software, API services, model outputs, customer data, or assets that are not theirs to license. Review all screenshots, fonts, logos, videos, sample data, and copied provider material before distributing a paid package.

If a separate paid license, support agreement, or white-label agreement is introduced later, it should clearly state what additional rights or services it grants and how it relates to the repository’s open-source license. This document is not a substitute for legal review.

## 7. Support boundary

A template seller should publish a specific support scope rather than promising unlimited implementation help.

| Support category | Suggested boundary |
|---|---|
| Included | Clarification of the setup guide, configuration-variable questions, and reproducible issues in the unmodified reference workflow |
| Limited | Help adapting field names, prompts, sheet columns, or branding, subject to the selected package |
| Separate service | Custom CRM/ERP integrations, production deployment, monitoring, compliance review, prompt redesign, data migration, and custom frontends |
| Excluded | Provider outages, provider billing disputes, customer legal advice, unsupported modifications, and business-result guarantees |

Document the support response window, supported versions, maintenance policy, refund terms, and escalation channel on the product page or purchase agreement. Keep these terms separate from the technical README so the repository can remain useful to both free and paid users.

## 8. Buyer production gate

A buyer should not expose Lumina to real callers until they have completed the synthetic test in `SETUP.md`, passed the operational checks in `OPERATIONS.md`, confirmed all third-party credentials and data flows, reviewed applicable legal obligations, and documented a rollback and human-escalation procedure.

## 9. Recommended product positioning

A defensible description is:

> **Lumina is a self-hosted Retell AI and n8n starter template for e-commerce delivery-support calls. It provides a configurable reference workflow for order lookup, support intents, escalation, and post-call analysis. Buyers connect their own provider accounts, data sources, credentials, and compliance controls.**

Avoid describing Lumina as a guaranteed autonomous customer-support system, a compliance-certified product, or a drop-in replacement for human support.
