# WhatsApp Cloud API - Bulk Messaging Service

A production-ready Node.js + TypeScript service for sending bulk WhatsApp messages via the official Meta Cloud API with queueing, rate limiting, and delivery tracking.

## 📁 Project Structure
- `src/services/whatsapp.service.ts`: Communicates with Meta Graph API.
- `src/queues/message.queue.ts` & `message.worker.ts`: BullMQ queue with automatic retries & rate-limiting.
- `src/controllers/message.controller.ts`: Bulk dispatch and campaign status tracking.
- `src/controllers/webhook.controller.ts`: Real-time status updates (SENT, DELIVERED, READ, FAILED).
- `prisma/schema.prisma`: SQLite database schema for campaigns and message logs.

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Open `.env` and fill in:
- `WHATSAPP_TOKEN`: From Meta Developer Portal
- `PHONE_NUMBER_ID`: From Meta Developer Portal
- `WABA_ID`: WhatsApp Business Account ID

### 3. Initialize SQLite Database
```bash
npx prisma db push
```

### 4. Start Redis
Make sure Redis is running locally:
```bash
brew services start redis
# or: redis-server
```

### 5. Start the Server
```bash
npm run dev
```

---

## 📡 API Usage

### 1. Send Bulk Messages
**Endpoint**: `POST http://localhost:3000/api/messages/bulk`

**Body**:
```json
{
  "campaignName": "Spring Sale 2026",
  "templateName": "hello_world",
  "languageCode": "en_US",
  "recipients": [
    { "phoneNumber": "+919876543210" },
    { "phoneNumber": "+919876543211" }
  ]
}
```

### 2. Check Campaign Status
**Endpoint**: `GET http://localhost:3000/api/campaigns/:campaignId`
