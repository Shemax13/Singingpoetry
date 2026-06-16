import { db } from '../_utils/db';
import { tg, parseTelegramMessage } from '../_utils/telegram';
import { jsonResponse } from '../_utils/auth';
import type { Env } from '../_utils/types';

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const update = await context.request.json<Record<string, unknown>>();
    const parsed = parseTelegramMessage(update);
    const bot = tg(context.env.TELEGRAM_BOT_TOKEN);

    if (parsed.type === 'unknown' || !parsed.messageId) {
      return jsonResponse({ ok: true });
    }

    if (parsed.type === 'video' && parsed.videoFileId) {
      const existing = await db(context.env.DB).getSongByTelegramMsgId(parsed.messageId);
      if (existing) return jsonResponse({ ok: true });

      const file = await bot.getFile(parsed.videoFileId);
      const videoUrl = bot.getFileUrl(file.file_path);
      const title = parsed.caption?.split('\n')[0]?.trim() || 'Untitled';

      await db(context.env.DB).upsertSong({
        title,
        lyrics: parsed.caption || null,
        tg_video_url: videoUrl,
        telegram_message_id: parsed.messageId,
        published_at: new Date().toISOString(),
      } as never);
    } else if (parsed.type === 'audio' && parsed.audioFileId) {
      const file = await bot.getFile(parsed.audioFileId);
      const audioUrl = bot.getFileUrl(file.file_path);

      await db(context.env.DB).addAudioBreakdown({
        song_id: 0,
        title: parsed.caption?.split('\n')[0]?.trim() || 'Audio Breakdown',
        file_url: audioUrl,
        duration: 0,
        telegram_message_id: parsed.messageId,
        visible: 1,
      });
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}
