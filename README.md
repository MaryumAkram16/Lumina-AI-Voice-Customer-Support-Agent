# Lumina-AI-Voice-Customer-Support-Agent

# 🧠 E-Commerce Voice AI – System Architecture

An advanced, production-ready voice automation system designed for modern e-commerce. This workflow leverages **Retell AI** for natural voice interactions and **n8n** for complex backend orchestration, providing a seamless customer experience for order tracking, cancellations, returns, and refunds.

---

## 📌 Problem Statement

Traditional e-commerce customer support faces several critical challenges:
*   **High Operational Costs:** Maintaining 24/7 human support for repetitive tasks like order tracking is expensive.
*   **Customer Friction:** Long wait times and complex IVR menus lead to poor customer satisfaction.
*   **Data Silos:** Support interactions are often disconnected from the actual order database, leading to manual data entry and errors.
*   **Scalability Issues:** Human teams cannot easily scale during peak seasons (e.g., Black Friday) without significant lead time and training.

## 💡 The Solution

The **E-Commerce Voice AI System** automates the entire post-purchase lifecycle through a conversational voice interface. By integrating high-fidelity AI voice synthesis with real-time database orchestration, the system provides:
*   **Instant Resolution:** Customers get immediate answers to order status queries without waiting.
*   **Self-Service Transactions:** Users can initiate cancellations and returns directly through voice, with the system enforcing business logic (e.g., return windows).
*   **Real-Time Sync:** Every interaction is logged, and order statuses are updated instantly in the backend (Google Sheets/CRM).
*   **Proactive Communication:** Automated SMS follow-ups ensure customers have a written record of their voice interaction.

---

## 🚀 Key Features

### 1. Intelligent Intent Routing
The system uses a sophisticated switch logic to identify user needs from the voice stream:
*   **Order Tracking:** Real-time lookup and conversational delivery of shipping status.
*   **Cancellation Management:** Automated eligibility checks based on delivery dates.
*   **Return Processing:** Collection of item condition and reasons with automated status updates.
*   **Refund Evaluation:** Policy-based assessment of refund requests.

### 2. Business Logic Enforcement
*   **Eligibility Engine:** Custom JavaScript nodes calculate if an order is within the allowed window for returns or cancellations.
*   **Data Validation:** Ensures Order IDs and customer details are verified before performing any write operations.

### 3. Comprehensive Logging & Analytics
*   **Call Metrics:** Captures duration, sentiment, and outcome for every call.
*   **Audit Trail:** Every status change is logged back to the database for transparency.

---

## 🛠 Tech Stack

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Voice Interface** | [Retell AI](https://www.retellai.com/) | Handles Speech-to-Text (STT), LLM processing, and Text-to-Speech (TTS). |
| **Orchestration** | [n8n](https://n8n.io/) | The "Brain" that manages logic, API calls, and data flow. |
| **Database** | Google Sheets | Acts as the lightweight CRM/Order Management System. |
| **Messaging** | SMS Integration | Sends confirmation details to the user's mobile device. |
| **Logic** | Node.js / JavaScript | Custom scripts within n8n for date calculations and message formatting. |

---

## ⚙️ Setup Guide

### Prerequisites
*   An **n8n** instance (Cloud or Self-hosted).
*   A **Retell AI** account and API Key.
*   A **Google Cloud Project** with Sheets API enabled and a Service Account JSON key.

### Installation Steps
1.  **Database Setup:**
    *   Create a Google Sheet with columns: `OrderID`, `CustomerName`, `Status`, `Delivery`, `Carrier`, `PhoneNo`, `Email`.
    *   Share the sheet with your Google Service Account email.
2.  **n8n Configuration:**
    *   Import the provided `.json` workflow file into n8n.
    *   Configure the **Google Sheets Account** credentials using your Service Account JSON.
    *   Update the `documentId` in the "Fetch Order Records" and other Google Sheets nodes to match your sheet's ID.
3.  **Retell AI Integration:**
    *   Create a new Agent in Retell AI.
    *   Set the **Custom Webhook URL** in Retell to point to your n8n Webhook node URL.
    *   Ensure the LLM prompt in Retell is configured to send the `intent` and `order_id` in the webhook payload.
4.  **Activation:**
    *   Set the n8n workflow to **Active**.
    *   Test the flow by calling your Retell AI number.

---

## 💰 Pricing Overview (Estimated)

| Service | Plan | Estimated Cost |
| :--- | :--- | :--- |
| **Retell AI** | Pay-as-you-go | ~$0.07 - $0.08 per minute |
| **n8n** | Starter / Self-hosted | $20/mo (Cloud) or Free (Self-hosted) |
| **Google Sheets** | Standard | Free (within API quotas) |
| **Telephony** | Twilio / Retell | ~$0.01 per minute |

> **Note:** Total cost per call is approximately **$0.10 per minute**, representing a >90% saving compared to human agents.

---
*Documentation generated by Manus AI.*
