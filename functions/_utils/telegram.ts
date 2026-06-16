const TELEGRAM_API = 'https://api.telegram.org/bot';

export function tg(token: string) {
  async function call(method: string, body?: Record<string, unknown>): Promise<unknown> {
    const url = `${TELEGRAM_API}${token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json<{ ok: boolean; result?: unknown }>();
    if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
    return data.result;
  }

  return {
    async getFile(fileId: string): Promise<{ file_path: string; file_size?: number }> {
      return call('getFile', { file_id: fileId }) as Promise<{ file_path: string; file_size?: number }>;
    },

    getFileUrl(filePath: string): string {
      return `${TELEGRAM_API}${token}/${filePath}`;
    },

    async getChat(chatId: string): Promise<unknown> {
      return call('getChat', { chat_id: chatId });
    },

    async setWebhook(url: string): Promise<unknown> {
      return call('setWebhook', { url, allowed_updates: ['message', 'channel_post'] });
    },

    async getUpdates(offset?: number): Promise<unknown[]> {
      return call('getUpdates', {
        ...(offset ? { offset } : {}),
        timeout: 30,
        allowed_updates: ['message', 'channel_post'],
      }) as Promise<unknown[]>;
    },
  };
}

export function parseTelegramMessage(msg: Record<string, unknown>): {
  type: 'video' | 'audio' | 'text' | 'unknown';
  messageId: number;
  videoFileId?: string;
  audioFileId?: string;
  caption?: string;
  text?: string;
} {
  const messageId = msg.message_id as number || msg.channel_post?.message_id as number;
  const message = (msg.message || msg.channel_post || msg) as Record<string, unknown>;
  const caption = message.caption as string | undefined;
  const text = message.text as string | undefined;

  if (message.video) {
    const video = message.video as Record<string, unknown>;
    return { type: 'video', messageId, videoFileId: video.file_id as string, caption };
  }
  if (message.audio) {
    const audio = message.audio as Record<string, unknown>;
    return { type: 'audio', messageId, audioFileId: audio.file_id as string, caption, text };
  }
  if (message.document) {
    const doc = message.document as Record<string, unknown>;
    const mime = (doc.mime_type as string) || '';
    if (mime.startsWith('audio/')) {
      return { type: 'audio', messageId, audioFileId: doc.file_id as string, caption, text };
    }
  }
  if (message.voice) {
    const voice = message.voice as Record<string, unknown>;
    return { type: 'audio', messageId, audioFileId: voice.file_id as string, caption };
  }
  if (text) {
    return { type: 'text', messageId, text };
  }
  return { type: 'unknown', messageId };
}
