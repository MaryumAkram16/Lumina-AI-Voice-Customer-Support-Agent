# Lumina-AI-Voice-Customer-Support-Agent

An advanced, automated voice-based customer support system designed for e-commerce platforms. This system leverages **Retell AI** for natural voice interactions and **n8n** for complex workflow orchestration, integrating seamlessly with **Google Sheets** to manage order data, cancellations, returns, and refunds.

---

## 📌 Problem Statement

Traditional e-commerce customer support often suffers from:
*   **High Operational Costs:** Maintaining 24/7 human support teams is expensive.
*   **Slow Response Times:** Customers often wait in long queues for simple tasks like order tracking.
*   **Inconsistent Service:** Human agents may provide varying levels of accuracy or tone.
*   **Scalability Issues:** Support teams struggle to handle sudden spikes in inquiry volume during sales or holidays.

## 💡 The Solution

The **E-Commerce Voice AI System** provides an automated, human-like voice interface that handles the most common customer inquiries instantly. By integrating a high-performance voice engine with a robust automation backend, the solution:
*   **Automates Routine Tasks:** Handles order tracking, cancellations, and returns without human intervention.
*   **Operates 24/7:** Provides immediate assistance at any time of day.
*   **Ensures Data Accuracy:** Directly interfaces with the business's database (Google Sheets) for real-time information.
*   **Reduces Friction:** Uses natural language processing to understand user intent and provide conversational responses.

## 🚀 Key Features

*   **Real-time Order Tracking:** Instantly retrieves order status, carrier info, and expected delivery dates.
*   **Intelligent Cancellation Logic:** Automatically checks if an order is within the allowed cancellation window before processing.
*   **Automated Returns & Refunds:** Guides users through the return process, captures item conditions, and evaluates refund eligibility based on business rules.
*   **Multi-Channel Notifications:** Can send follow-up details via SMS or Email (extensible).
*   **Call Analytics:** Logs call metrics and events for post-call analysis and service improvement.
*   **Conversational Intent Routing:** Sophisticated routing logic to handle various customer needs within a single call.

## 🛠 Tech Stack

*   **Voice Engine:** [Retell AI](https://www.retellai.com/) (Conversational Voice API)
*   **Orchestration:** [n8n](https://n8n.io/) (Workflow Automation Tool)
*   **Database:** [Google Sheets](https://www.google.com/sheets/about/) (Lightweight CRM/Order Management)
*   **AI Models:** Gemini 2.5 Flash (for call analysis and intent extraction)
*   **Logic:** JavaScript (Node.js) within n8n Code nodes
*   **Communication:** Webhooks for real-time data exchange

## 🏗 System Architecture

![System Architecture](docs/architecture.png)

The system follows a modular event-driven architecture:
1.  **Voice Layer:** Retell AI handles the real-time audio stream, STT (Speech-to-Text), and TTS (Text-to-Speech).
2.  **Logic Layer:** n8n acts as the brain, receiving structured data from Retell, performing database lookups, and executing business logic.
3.  **Data Layer:** Google Sheets serves as a flexible, real-time database for order and customer information.
4.  **Intelligence Layer:** Gemini AI performs post-call analysis to extract sentiment and key metrics.

## 🔌 API Reference (n8n Webhook)

The n8n workflow expects a `POST` request with the following JSON structure from Retell:

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `order_id` | `string` | The customer's order identification number. |
| `intent` | `string` | The detected intent (e.g., `track_order`, `cancel_order`). |
| `email` | `string` | Customer email address for verification. |
| `phone_no` | `string` | Customer phone number. |

## 🛡 Security & Compliance

*   **Data Encryption:** All data in transit is encrypted via HTTPS/TLS.
*   **Access Control:** Google Sheets access is restricted via Service Account credentials.
*   **Privacy:** No audio recordings are stored in the n8n environment; only structured metadata is processed.

## ❓ Troubleshooting

| Issue | Possible Cause | Solution |
| :--- | :--- | :--- |
| **Agent doesn't respond** | Webhook URL mismatch | Verify the URL in Retell matches the n8n production webhook. |
| **Order not found** | Sheet permissions | Ensure the Google Sheet is shared with the Service Account email. |
| **Wrong intent routing** | Tool definition error | Check that tool names in Retell match the switch logic in n8n. |
| **Latency issues** | Server region | Host n8n in a region close to Retell's servers (e.g., US-East). |

## ⚙️ Setup Guide

### 1. Prerequisites
*   An **n8n** instance (Cloud or Self-hosted).
*   A **Retell AI** account and API Key.
*   A **Google Cloud Console** project with Google Sheets API enabled and Service Account credentials.

### 2. Google Sheets Configuration
1.  Create a Google Sheet with the following columns: `OrderID`, `CustomerName`, `Status`, `Carrier`, `DeliveryLocation`, `Delivery`, `TrackingSteps`, `PhoneNo`, `Email`.
2.  Share the sheet with your Google Service Account email.
3.  Note the `Document ID` and `Sheet Name`.

### 3. n8n Workflow Import
1.  Download the `voiceagent.json` file from this repository.
2.  In n8n, click on **Workflows** > **Import from File** and select the JSON.
3.  Configure the **Google Sheets** nodes with your credentials and Document ID.
4.  Activate the workflow to generate your **Webhook URL**.

### 4. Retell AI Configuration
1.  **Create an Agent:** In the [Retell AI Dashboard](https://dashboard.retellai.com/), navigate to **Agents** and click **Create New Agent**.
2.  **Select LLM Type:** Choose **Custom LLM** to connect with n8n.
3.  **Set Webhook URL:** Copy the **Production Webhook URL** from your n8n "Incoming Voice Agent Request" node and paste it into the **LLM URL** field in Retell.
4.  **Define Tools:** Add tools in Retell that match the intents in your n8n workflow (e.g., `track_order`, `cancel_order`). Ensure the tool names and parameters match exactly what the n8n workflow expects.
5.  **Voice Selection:** Choose a voice (e.g., ElevenLabs Cimo) and adjust the interruption sensitivity (recommended: 0.9).

### 5. Connecting Retell to Your Website
To add the voice agent to your website, you have two primary options:

#### Option A: Retell Web Widget (Easiest)
1.  In the Retell Dashboard, go to **Web Call** settings.
2.  Customize the widget appearance (colors, icon, position).
3.  Copy the provided JavaScript snippet.
4.  Paste the snippet into the `<head>` or before the closing `</body>` tag of your website's HTML.

#### Option B: Custom Frontend Integration (Advanced)
If you want a custom button or UI:
1.  Install the Retell Client SDK: `npm install retell-client-js-sdk`.
2.  Initialize the client in your frontend code:
    ```javascript
    import { RetellWebClient } from "retell-client-js-sdk";
    const retellClient = new RetellWebClient();
    
    // To start a call
    retellClient.startCall({
      accessToken: "YOUR_ACCESS_TOKEN", // Generated via your backend
    });
    ```
3.  Create a backend endpoint to generate the `access_token` using your Retell API Key.

## 💰 Cost Estimation

| Component | Estimated Monthly Cost (Low Volume) | Estimated Monthly Cost (High Volume) |
| :--- | :--- | :--- |
| **Retell AI** | ~$50 (Pay-as-you-go) | $500+ |
| **n8n Cloud** | $20 (Starter Plan) | $120+ (Pro/Enterprise) |
| **Google Workspace** | $6 (Basic) | $18+ (Business) |
| **AI Tokens (Gemini)** | ~$5 (Low usage) | $50+ |
| **Total** | **~$81 / month** | **~$688+ / month** |

*Note: Costs are estimates based on standard pricing as of early 2026 and vary based on actual call volume and duration.*

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
