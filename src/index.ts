import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { register, login, getProfile, listAllCustomers, deleteCustomer } from './controllers/auth.controller';
import { sendBulkMessages, listCustomerCampaigns, getCampaignDetails, getCustomerTemplates } from './controllers/message.controller';
import { verifyWebhook, handleWebhookEvents } from './controllers/webhook.controller';
import { authMiddleware, AuthRequest } from './middlewares/auth.middleware';
import { WhatsAppService } from './services/whatsapp.service';
import { PrismaClient } from '@prisma/client';
import './queues/message.worker';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const waService = new WhatsAppService();

app.use(cors());
app.use(express.json());

// Serve Static Frontend Dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Authentication Routes
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/profile', authMiddleware, getProfile);

// Admin Management Routes
app.get('/api/admin/customers', authMiddleware, listAllCustomers);
app.delete('/api/admin/customers/:id', authMiddleware, deleteCustomer);

// Authenticated Campaign Routes
app.get('/api/templates', authMiddleware, getCustomerTemplates);
app.post('/api/messages/bulk', authMiddleware, sendBulkMessages);
app.get('/api/campaigns', authMiddleware, listCustomerCampaigns);
app.get('/api/campaigns/:id', authMiddleware, getCampaignDetails);

// Update Customer Meta Phone ID / Token Route
app.put('/api/auth/profile', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  const userId = req.userId;
  const { businessName, phoneNumberId, accessToken, wabaId } = req.body;

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        businessName: businessName || undefined,
        phoneNumberId: phoneNumberId || undefined,
        accessToken: accessToken || undefined,
        wabaId: wabaId || undefined,
      },
    });

    return res.json({
      success: true,
      message: 'Account settings updated successfully!',
      user: {
        id: updated.id,
        email: updated.email,
        businessName: updated.businessName,
        phoneNumberId: updated.phoneNumberId,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Instant Sandbox Test Route (Uses the Customer's Registered Phone Number ID)
app.post('/api/messages/sandbox-test', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  const userId = req.userId;
  const { recipientNumber } = req.body;

  if (!recipientNumber) {
    return res.status(400).json({ error: 'recipientNumber is required.' });
  }

  const dbUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!dbUser || !dbUser.phoneNumberId || !dbUser.accessToken) {
    return res.status(400).json({ error: 'Please configure your Phone Number ID and Access Token.' });
  }

  try {
    const result = await waService.sendTemplateMessage({
      phoneNumberId: dbUser.phoneNumberId,
      token: dbUser.accessToken,
      to: recipientNumber.replace(/[^0-9]/g, ''),
      templateName: 'hello_world',
      languageCode: 'en_US',
    });
    return res.json({ success: true, message: 'Delivered via Sandbox!', result });
  } catch (err: any) {
    const errMsg = err.response?.data?.error?.message || err.message;
    return res.status(500).json({ error: errMsg });
  }
});

// Meta Webhook Verification & Delivery Receipts
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookEvents);

// Quick Helper to Promote Any User to Admin (For Testing / Owner Setup)
app.post('/api/admin/make-admin', async (req: express.Request, res: express.Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const updated = await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN' },
    });
    return res.json({ success: true, message: `User ${email} is now an ADMIN! Please sign in again.` });
  } catch (err) {
    return res.status(404).json({ error: `User with email "${email}" not found.` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Grambi SaaS Platform live on http://localhost:${PORT}`);
});
