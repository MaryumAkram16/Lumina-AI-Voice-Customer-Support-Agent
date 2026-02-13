# Lumina AI Voice Customer Support Agent

An advanced, automated voice-based customer support system designed for e-commerce platforms. This system leverages Retell AI for natural voice interactions and n8n for complex workflow orchestration, integrating seamlessly with Google Sheets to manage order data, cancellations, returns, and refunds.

## Table of Contents
- [Introduction](#introduction)
- [Problem Statement](#problem-statement)
- [Solution](#solution)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [API Reference](#api-reference)
- [Security & Compliance](#security--compliance)
- [Setup Guide](#setup-guide)
- [Troubleshooting](#troubleshooting)
- [Cost Estimation](#cost-estimation)
- [Contributing](#contributing)
- [License](#license)

## Introduction
Lumina is an AI voice customer support agent that helps businesses streamline their customer service process using advanced voice recognition and response technology. It's specifically designed for e-commerce platforms to handle routine customer inquiries automatically, 24/7, with human-like conversational abilities.

## Problem Statement
Traditional e-commerce customer support often suffers from:

- **High Operational Costs**: Maintaining 24/7 human support teams is expensive.
- **Slow Response Times**: Customers often wait in long queues for simple tasks like order tracking.
- **Inconsistent Service**: Human agents may provide varying levels of accuracy or tone.
- **Scalability Issues**: Support teams struggle to handle sudden spikes in inquiry volume during sales or holidays.

## Solution
The E-Commerce Voice AI System provides an automated, human-like voice interface that handles the most common customer inquiries instantly. By integrating a high-performance voice engine with a robust automation backend, the solution:

- **Automates Routine Tasks**: Handles order tracking, cancellations, and returns without human intervention.
- **Operates 24/7**: Provides immediate assistance at any time of day.
- **Ensures Data Accuracy**: Directly interfaces with the business's database (Google Sheets) for real-time information.
- **Reduces Friction**: Uses natural language processing to understand user intent and provide conversational responses.

## Key Features

- **Real-time Order Tracking**: Instantly retrieves order status, carrier info, and expected delivery dates.
- **Intelligent Cancellation Logic**: Automatically checks if an order is within the allowed cancellation window before processing.
- **Automated Returns & Refunds**: Guides users through the return process, captures item conditions, and evaluates refund eligibility based on business rules.
- **Multi-Channel Notifications**: Can send follow-up details via SMS or Email (extensible).
- **Call Analytics**: Logs call metrics and events for post-call analysis and service improvement.
- **Conversational Intent Routing**: Sophisticated routing logic to handle various customer needs within a single call.

## Workflow Screenshot

![Workflow Screenshot](https://raw.githubusercontent.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent/main/lumina.PNG?raw=true)


## Tech Stack

- **Voice Engine**: Retell AI (Conversational Voice API)
- **Orchestration**: n8n (Workflow Automation Tool)
- **Database**: Google Sheets (Lightweight CRM/Order Management)
- **AI Models**: Gemini 2.5 Flash (for call analysis and intent extraction)
- **Logic**: JavaScript (Node.js) within n8n Code nodes
- **Communication**: Webhooks for real-time data exchange

## System Architecture

The system follows a modular event-driven architecture:

1. **Voice Layer**: Retell AI handles the real-time audio stream, STT (Speech-to-Text), and TTS (Text-to-Speech).
2. **Logic Layer**: n8n acts as the brain, receiving structured data from Retell, performing database lookups, and executing business logic.
3. **Data Layer**: Google Sheets serves as a flexible, real-time database for order and customer information.
4. **Intelligence Layer**: Gemini AI performs post-call analysis to extract sentiment and key metrics.

### Data Flow:
1. Customer initiates voice call → Retell AI processes audio input
2. Intent detected → Webhook triggers n8n workflow
3. n8n queries Google Sheets for order/customer data
4. Business logic executed (track order, process cancellation, etc.)
5. Response generated → Retell AI converts to natural speech
6. Post-call analytics logged → Gemini AI analyzes sentiment/metrics

## API Reference (n8n Webhook)

The n8n workflow expects a POST request with the following JSON structure from Retell:

```json
{
  "order_id": "ORD-12345",
  "intent": "track_order",
  "email": "customer@example.com",
  "phone_no": "+1-555-0100",
  "customer_name": "John Doe"
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `order_id` | string | The customer's order identification number. |
| `intent` | string | The detected intent (e.g., `track_order`, `cancel_order`, `return_item`). |
| `email` | string | Customer email address for verification. |
| `phone_no` | string | Customer phone number. |
| `customer_name` | string | Customer's full name for personalization. |

### Response Example:
```json
{
  "success": true,
  "status": "shipped",
  "tracking_number": "1Z999AA10123456784",
  "carrier": "UPS",
  "delivery_date": "2026-02-15"
}
```

## Security & Compliance

- **Data Encryption**: All data in transit is encrypted via HTTPS/TLS.
- **Access Control**: Google Sheets access is restricted via Service Account credentials.
- **Privacy**: No audio recordings are stored in the n8n environment; only structured metadata is processed.
- **GDPR Compliant**: Customer data is handled according to GDPR standards.
- **PCI Compliance**: No payment card data is processed or stored in this system.

## Setup Guide

### Prerequisites

- An n8n instance (Cloud or Self-hosted)
- A Retell AI account and API Key
- A Google Cloud Console project with Google Sheets API enabled and Service Account credentials
- Node.js (v14 or higher) for local development

### 1. Google Sheets Configuration

1. Create a Google Sheet with the following columns:
   - OrderID
   - CustomerName
   - Status
   - Carrier
   - DeliveryLocation
   - Delivery
   - TrackingSteps
   - PhoneNo
   - Email

2. Share the sheet with your Google Service Account email.
3. Note the Document ID and Sheet Name for later use.

### 2. n8n Workflow Import

1. Download the `voiceagent.json` file from this repository.
2. In n8n, click on **Workflows > Import from File** and select the JSON.
3. Configure the Google Sheets nodes with your credentials and Document ID.
4. Activate the workflow to generate your Webhook URL.

### 3. Retell AI Configuration

1. Create an Agent: In the Retell AI Dashboard, navigate to Agents and click **Create New Agent**.
2. Select LLM Type: Choose **Custom LLM** to connect with n8n.
3. Set Webhook URL: Copy the Production Webhook URL from your n8n "Incoming Voice Agent Request" node and paste it into the LLM URL field in Retell.
4. Define Tools: Add tools in Retell that match the intents in your n8n workflow (e.g., `track_order`, `cancel_order`). Ensure the tool names and parameters match exactly what the n8n workflow expects.
5. Voice Selection: Choose a voice (e.g., ElevenLabs Cimo) and adjust the interruption sensitivity (recommended: 0.9).

### 4. Connecting Retell to Your Website

#### Option A: Retell Web Widget (Easiest)

1. In the Retell Dashboard, go to **Web Call settings**.
2. Customize the widget appearance (colors, icon, position).
3. Copy the provided JavaScript snippet.
4. Paste the snippet into the `<head>` or before the closing `</body>` tag of your website's HTML.

#### Option B: Custom Frontend Integration (Advanced)

1. Install the Retell Client SDK:
   ```bash
   npm install retell-client-js-sdk
   ```

2. Initialize the client in your frontend code:
   ```javascript
   import { RetellWebClient } from "retell-client-js-sdk";
   const retellClient = new RetellWebClient();
   
   // To start a call
   retellClient.startCall({
     accessToken: "YOUR_ACCESS_TOKEN", // Generated via your backend
   });
   ```

3. Create a backend endpoint to generate the `access_token` using your Retell API Key.

## Quick Start

1. **Installation**: To get started with Lumina, clone the repository
   ```bash
   git clone https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent.git
   cd Lumina-AI-Voice-Customer-Support-Agent
   ```

2. **Setup**: Ensure you have the necessary dependencies installed. Run:
   ```bash
   npm install
   ```

3. **Run**: Start the application using:
   ```bash
   npm start
   ```

## Examples

- **Basic Usage**: Here's how to initiate a conversation:
   ```js
   const lumina = require('lumina');
   lumina.startConversation();
   ```

- **Handling Queries**: To handle customer queries effectively:
   ```js
   lumina.handleQuery('How can I track my order?');
   ```

- **Initiating Voice Call** (Frontend):
   ```javascript
   import { RetellWebClient } from "retell-client-js-sdk";
   
   const client = new RetellWebClient();
   
   document.getElementById("startCall").addEventListener("click", async () => {
     const token = await fetch("/api/get-access-token").then(r => r.json());
     client.startCall({
       accessToken: token.access_token,
       agentId: "YOUR_AGENT_ID"
     });
   });
   ```

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Agent doesn't respond | Webhook URL mismatch | Verify the URL in Retell matches the n8n production webhook. |
| Order not found | Sheet permissions | Ensure the Google Sheet is shared with the Service Account email. |
| Wrong intent routing | Tool definition error | Check that tool names in Retell match the switch logic in n8n. |
| Latency issues | Server region | Host n8n in a region close to Retell's servers (e.g., US-East). |
| Audio quality poor | Network issues | Ensure stable internet connection; reduce background noise. |
| Webhook timeout | Slow database queries | Optimize Google Sheets queries; consider caching frequently accessed data. |

### Common Error Messages:

- **"Invalid API Key"**: Check your Retell AI API credentials in n8n.
- **"Service Account unauthorized"**: Re-share your Google Sheet with the correct Service Account email.
- **"Webhook failed"**: Check n8n workflow logs for specific error details.

## Cost Estimation

| Component | Low Volume | High Volume |
|-----------|-----------|-------------|
| Retell AI | ~$50/month | $500+/month |
| n8n Cloud | $20/month | $120+/month |
| Google Workspace | $6/month | $18+/month |
| AI Tokens (Gemini) | ~$5/month | $50+/month |
| **Total** | **~$81/month** | **~$688+/month** |

*Note: Costs are estimates based on standard pricing as of February 2026 and vary based on actual call volume, duration, and regional pricing.*

### Volume Tiers:
- **Low Volume**: 100-500 calls/month
- **High Volume**: 5,000+ calls/month

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository.
2. Create a new branch (e.g., `feature-xyz` or `bugfix-issue-123`).
3. Make your changes and commit them with clear, descriptive messages.
4. Push to your branch and open a Pull Request with a detailed description.
5. Ensure all tests pass and code follows our style guidelines.

Thank you for helping us improve Lumina!

## License

This project is licensed under the MIT License - see the LICENSE file for details.
