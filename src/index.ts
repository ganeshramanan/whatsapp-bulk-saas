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

// Instant Sandbox Test Route (No Template Approval Required!)
app.post('/api/messages/sandbox-test', authMiddleware, async (req: any, res: any) => {
  const userId = req.userId;
  const { recipientNumber } = req.body;

  if (!recipientNumber) {
    return res.status(400).json({ error: 'recipientNumber is required.' });
  }

  // Uses Meta Public Sandbox Phone Number ID
  const SANDBOX_PHONE_ID = '1063255519739985'; // From your Meta dashboard test number
  const user = await (await import('@prisma/client')).PrismaClient.prototype;
  const prisma = new (await import('@prisma/client')).PrismaClient();
  const dbUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!dbUser || !dbUser.accessToken) {
    return res.status(400).json({ error: 'Please save your access token first.' });
  }

  try {
    const { WhatsAppService } = await import('./services/whatsapp.service');
    const wa = new WhatsAppService();
    const result = await wa.sendTemplateMessage({
      phoneNumberId: SANDBOX_PHONE_ID,
      token: dbUser.accessToken,
      to: recipientNumber.replace(/[^0-9]/g, ''),
      templateName: 'hello_world',
      languageCode: 'en_US',
    });
    return res.json({ success: true, message: 'Delivered via Sandbox!', result });
  } catch (err: any) {
    return res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// Meta Webhook Verification & Delivery Receipts
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookEvents);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Grambi SaaS Platform live on http://localhost:${PORT}`);
});
