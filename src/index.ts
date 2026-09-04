import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { register, login, getProfile } from './controllers/auth.controller';
import { sendBulkMessages, listCustomerCampaigns, getCampaignDetails } from './controllers/message.controller';
import { verifyWebhook, handleWebhookEvents } from './controllers/webhook.controller';
import { authMiddleware } from './middlewares/auth.middleware';
import './queues/message.worker';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Frontend Dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Authentication Routes
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/profile', authMiddleware, getProfile);

// Authenticated Campaign Routes
app.post('/api/messages/bulk', authMiddleware, sendBulkMessages);
app.get('/api/campaigns', authMiddleware, listCustomerCampaigns);
app.get('/api/campaigns/:id', authMiddleware, getCampaignDetails);

// Meta Webhook Verification & Delivery Receipts
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookEvents);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Grambi SaaS Platform live on http://localhost:${PORT}`);
});
