import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { bulkMessageQueue } from '../queues/message.queue';
import { WhatsAppService } from '../services/whatsapp.service';
import { z } from 'zod';
import { AuthRequest } from '../middlewares/auth.middleware';

const prisma = new PrismaClient();
const waService = new WhatsAppService();

// Fetch live templates dynamically from Meta Cloud API
export const getCustomerTemplates = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  // WABA ID is required by Meta to query message_templates
  // If user hasn't configured WABA ID yet, we try to use environment WABA ID or return only hello_world
  const wabaId = user?.wabaId || process.env.WABA_ID;
  const token = user?.accessToken || process.env.WHATSAPP_TOKEN;

  if (!wabaId || !token) {
    return res.json({
      templates: [
        { name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }
      ]
    });
  }

  try {
    const axios = (await import('axios')).default;
    const url = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const metaTemplates = response.data.data || [];
    const formatted = metaTemplates.map((t: any) => ({
      name: t.name,
      status: t.status, // APPROVED, IN_REVIEW, REJECTED, PENDING
      category: t.category,
      language: t.language,
    }));

    return res.json({ templates: formatted });
  } catch (err: any) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error('Failed to fetch live Meta templates:', errMsg);
    return res.json({
      templates: [
        { name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }
      ]
    });
  }
};

const BulkSendSchema = z.object({
  campaignName: z.string().min(1),
  templateName: z.string().default('general_broadcast'),
  messageText: z.string().optional(), // For universal template variable {{1}}
  languageCode: z.string().default('en_US'),
  recipients: z.array(
    z.object({
      phoneNumber: z.string(),
      components: z.array(z.any()).optional(),
    })
  ).min(1),
});

export const sendBulkMessages = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  const parseResult = BulkSendSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { campaignName, templateName, messageText, languageCode, recipients } = parseResult.data;

  // 1. Fetch the logged-in customer's Meta credentials & Wallet Balance
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.phoneNumberId || !user.accessToken) {
    return res.status(400).json({
      error: 'WhatsApp credentials missing on your account. Please contact support.',
    });
  }

  const pricePerMessage = user.pricePerMessage || 1.0;
  const totalCost = recipients.length * pricePerMessage;

  // Check if user has enough balance
  if (user.walletBalance < totalCost) {
    const maxPossible = Math.floor(user.walletBalance / pricePerMessage);
    return res.status(402).json({
      error: `Insufficient wallet balance. Required: ₹${totalCost.toFixed(2)}, Available: ₹${user.walletBalance.toFixed(2)}. You can only send to ${maxPossible} numbers. Please top up your wallet.`,
    });
  }

  // Deduct wallet balance
  await prisma.user.update({
    where: { id: user.id },
    data: { walletBalance: { decrement: totalCost } },
  });

  // 2. Create campaign record linked to this customer
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name: campaignName,
      templateName,
      languageCode,
    },
  });

  // 3. Create message records in DB
  const sanitizedRecipients = recipients.map(r => ({
    phoneNumber: r.phoneNumber.replace(/[^0-9]/g, ''),
    components: r.components || (messageText ? [
      {
        type: 'body',
        parameters: [{ type: 'text', text: messageText }]
      }
    ] : undefined)
  }));

  const records = await prisma.$transaction(
    sanitizedRecipients.map(r =>
      prisma.messageRecord.create({
        data: {
          campaignId: campaign.id,
          phoneNumber: r.phoneNumber,
          status: 'PENDING',
        },
      })
    )
  );

  // 4. Push jobs into queue with this specific customer's token & phone ID
  const jobs = records.map((record, index) => ({
    name: `send-${record.phoneNumber}`,
    data: {
      recordId: record.id,
      phoneNumberId: user.phoneNumberId!,
      token: user.accessToken!,
      phoneNumber: record.phoneNumber,
      templateName,
      languageCode,
      components: sanitizedRecipients[index].components,
    },
  }));

  await bulkMessageQueue.addBulk(jobs);

  return res.status(202).json({
    message: 'Broadcast launched successfully!',
    campaignId: campaign.id,
    totalQueued: jobs.length,
  });
};

export const listCustomerCampaigns = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { messages: true },
    take: 30,
  });

  const formatted = campaigns.map((c) => {
    const summary = c.messages.reduce(
      (acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return {
      id: c.id,
      name: c.name,
      templateName: c.templateName,
      languageCode: c.languageCode,
      createdAt: c.createdAt,
      total: c.messages.length,
      summary,
    };
  });

  return res.json(formatted);
};

export const getCampaignDetails = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    include: { messages: true },
  });

  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }

  const summary = campaign.messages.reduce(
    (acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return res.json({
    campaignId: campaign.id,
    name: campaign.name,
    summary,
    messages: campaign.messages,
  });
};
