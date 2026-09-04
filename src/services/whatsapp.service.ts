import axios from 'axios';

const GRAPH_API_VERSION = 'v20.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{
    type: 'text' | 'image' | 'document' | 'video';
    text?: string;
    image?: { link: string };
  }>;
}

export function parseMetaError(error: any): { isRetryable: boolean; userFriendlyMsg: string } {
  const fbError = error.response?.data?.error;
  const code = fbError?.code;
  const subcode = fbError?.error_subcode;
  const rawMsg = fbError?.error_user_msg || fbError?.message || error.message || 'Unknown delivery failure';

  // 1. Transient / Temporary Failures -> RETRYABLE
  if (code === 130429 || code === 80007) {
    return { isRetryable: true, userFriendlyMsg: 'Rate limit hit (Meta Tier Quota exceeded). Retrying automatically...' };
  }
  if (code === 2 || code === 1) {
    return { isRetryable: true, userFriendlyMsg: 'Meta API temporary server outage. Retrying automatically...' };
  }
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return { isRetryable: true, userFriendlyMsg: 'Network timeout connecting to Meta. Retrying...' };
  }

  // 2. Permanent / User-Specific Failures -> NON-RETRYABLE (Fail fast to save server resources)
  if (code === 131026) {
    return { isRetryable: false, userFriendlyMsg: 'Recipient has blocked this business on WhatsApp.' };
  }
  if (code === 131030) {
    return { isRetryable: false, userFriendlyMsg: 'Phone number is not verified on Meta Test Sandbox list.' };
  }
  if (code === 131051) {
    return { isRetryable: false, userFriendlyMsg: 'Invalid phone number or number does not exist on WhatsApp.' };
  }
  if (code === 132001) {
    return { isRetryable: false, userFriendlyMsg: 'Template does not exist or language code mismatch.' };
  }
  if (code === 132015) {
    return { isRetryable: false, userFriendlyMsg: 'Template is paused or disabled due to low quality rating.' };
  }
  if (code === 190) {
    return { isRetryable: false, userFriendlyMsg: 'Meta Access Token is expired or invalid. Please update in Settings.' };
  }

  return { isRetryable: false, userFriendlyMsg: rawMsg };
export class WhatsAppService {
  async sendTemplateMessage(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    templateName: string;
    languageCode?: string;
    components?: TemplateComponent[];
  }) {
    const url = `${BASE_URL}/${params.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: {
          code: params.languageCode || 'en_US',
        },
        components: params.components || [],
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }
}
