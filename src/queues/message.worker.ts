import { Worker, Job } from 'bullmq';
import { redisConnection } from './message.queue';
import { WhatsAppService, TemplateComponent } from '../services/whatsapp.service';
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
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error(`[Worker] ❌ Failed to send message to ${phoneNumber}:`, errorMsg);

      await prisma.messageRecord.update({
        where: { id: recordId },
        data: {
          status: 'FAILED',
          errorMessage: errorMsg,
        },
      });

      throw error;
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
