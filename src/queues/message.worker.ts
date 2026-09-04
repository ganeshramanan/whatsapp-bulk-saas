import { Worker, Job } from 'bullmq';
import { redisConnection } from './message.queue';
import { WhatsAppService, TemplateComponent, parseMetaError } from '../services/whatsapp.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const waService = new WhatsAppService();

export interface JobData {
  recordId: string;
  phoneNumberId: string;
  token: string;
  phoneNumber: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
}

export const messageWorker = new Worker<JobData>(
  'bulk-messages',
  async (job: Job<JobData>) => {
    console.log(`[Worker] Processing job ${job.id} for phone ${job.data.phoneNumber} with template ${job.data.templateName}`);
    const { recordId, phoneNumberId, token, phoneNumber, templateName, languageCode, components } = job.data;

    try {
      const result = await waService.sendTemplateMessage({
        phoneNumberId,
        token,
        to: phoneNumber,
        templateName,
        languageCode,
        components,
      });

      console.log(`[Worker] ✅ Message sent successfully! Result:`, result);
      const wamid = result.messages?.[0]?.id;

      await prisma.messageRecord.update({
        where: { id: recordId },
        data: {
          status: 'SENT',
          wamid: wamid,
          sentAt: new Date(),
        },
      });

      return { status: 'SENT', wamid };
    } catch (error: any) {
      const { isRetryable, userFriendlyMsg } = parseMetaError(error);
      console.error(`[Worker] ❌ Failed to send to ${phoneNumber}:`, userFriendlyMsg);

      await prisma.messageRecord.update({
        where: { id: recordId },
        data: {
          status: 'FAILED',
          errorMessage: userFriendlyMsg,
        },
      });

      // Only throw to BullMQ for automatic exponential retry if the error is temporary/network/rate-limit
      if (isRetryable) {
        throw error;
      }
      // If it's a permanent user error (invalid number, template missing), don't waste retry loops
      return { status: 'FAILED', error: userFriendlyMsg };
    }
  },
  {
    connection: redisConnection,
    limiter: {
      max: 50,
      duration: 1000,
    },
    concurrency: 10,
  }
);
