import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

export const handleWebhookEvents = async (req: Request, res: Response) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === 'whatsapp_business_account') {
    const entries = body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const statuses = change.value?.statuses || [];
        for (const status of statuses) {
          const wamid = status.id;
          const statusType = status.status;

          const updateData: any = {
            status: statusType.toUpperCase(),
          };

          if (statusType === 'delivered') updateData.deliveredAt = new Date();
          if (statusType === 'read') updateData.readAt = new Date();
          if (statusType === 'failed') {
            updateData.errorMessage = status.errors?.[0]?.message || 'Unknown delivery failure';
          }

          await prisma.messageRecord.updateMany({
            where: { wamid },
            data: updateData,
          });
        }
      }
    }
  }
};
