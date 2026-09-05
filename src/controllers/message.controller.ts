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
  
  const token = user?.accessToken || process.env.WHATSAPP_TOKEN;
  let wabaId = user?.wabaId || process.env.WABA_ID;

  if (!token) {
    return res.json({
      templates: [
        { name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }
      ]
    });
  }

  try {
    const axios = (await import('axios')).default;

    // If wabaId is not explicitly set, auto-discover it from the phoneNumberId or /me/accounts using Meta Graph API
    if (!wabaId && user?.phoneNumberId) {
      try {
        // Method 1: Query phone number details to find the parent WABA
        const phoneLookup = await axios.get(`https://graph.facebook.com/v20.0/${user.phoneNumberId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (phoneLookup.data?.whatsapp_business_account_id) {
          wabaId = phoneLookup.data.whatsapp_business_account_id;
        } else if (phoneLookup.data?.id && phoneLookup.data?.account_mode) {
          wabaId = phoneLookup.data.id;
        }
      } catch (lookupErr: any) {
        // Method 2: Query the token's businesses or debug token to find WABA ID
        try {
          const debugLookup = await axios.get(`https://graph.facebook.com/v20.0/debug_token?input_token=${token}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const granularScopes = debugLookup.data?.data?.granular_scopes || [];
          const wabaScope = granularScopes.find((s: any) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging');
          if (wabaScope?.target_ids?.length > 0) {
            wabaId = wabaScope.target_ids[0];
          }
        } catch (e) {
          // ignore
        }
      }

      if (wabaId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { wabaId }
        });
      }
    }

    if (!wabaId) {
      console.warn('WABA ID not found. Return hello_world fallback.');
      return res.json({
        templates: [
          { name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }
        ]
      });
    }

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

    // Ensure hello_world is always available as a test template if not present
    if (!formatted.some((t: any) => t.name === 'hello_world')) {
      formatted.unshift({ name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US' });
    }

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

  // 1. Fetch the logged-in customer's Meta credentials
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.phoneNumberId || !user.accessToken) {
    return res.status(400).json({
      error: 'WhatsApp credentials missing on your account. Please contact support.',
    });
  }

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

    // Collect first failure reason to show on dashboard
    const firstFailedMessage = c.messages.find(m => m.status === 'FAILED' && m.errorMessage);
    const failureReason = firstFailedMessage ? firstFailedMessage.errorMessage : null;

    return {
      id: c.id,
      name: c.name,
      templateName: c.templateName,
      languageCode: c.languageCode,
      createdAt: c.createdAt,
      total: c.messages.length,
      summary,
      failureReason,
    };
  });

  return res.json(formatted);
};

export const exportCampaignCSV = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  const { id } = req.params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    include: { messages: true },
  });

  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }

  // Generate CSV rows
  const header = 'Phone Number,Status,WhatsApp Message ID,Error Message,Sent At,Delivered At,Read At\n';
  const rows = campaign.messages.map(m => {
    return `"${m.phoneNumber}","${m.status}","${m.wamid || ''}","${(m.errorMessage || '').replace(/"/g, '""')}","${m.sentAt ? m.sentAt.toISOString() : ''}","${m.deliveredAt ? m.deliveredAt.toISOString() : ''}","${m.readAt ? m.readAt.toISOString() : ''}"`;
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}_report.csv"`);
  return res.send(header + rows);
};
