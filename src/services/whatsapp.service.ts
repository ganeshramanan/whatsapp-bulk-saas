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
