import { db } from '../../_utils/db';
import { requireAuth, jsonResponse, handleOptions } from '../../_utils/auth';
import { tg, parseTelegramMessage } from '../../_utils/telegram';
import type { Env } from '../../_utils/types';

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const bot = tg(context.env.TELEGRAM_BOT_TOKEN);
    const body = await context.request.json<{ chat_id?: string; limit?: number }>().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 100);

    const updates = await bot.getUpdates() as Record<string, unknown>[];
    let synced = 0;

    for (const update of updates) {
      const msg = update.message as Record<string, unknown> || update.channel_post as Record<string, unknown>;
      if (!msg) continue;

      const parsed = parseTelegramMessage(update);
      if (parsed.type === 'unknown') continue;
      if (parsed.messageId && await db(context.env.DB).getSongByTelegramMsgId(parsed.messageId)) continue;

      if (parsed.type === 'video' && parsed.videoFileId) {
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
        synced++;
      } else if (parsed.type === 'audio' && parsed.audioFileId) {
        const file = await bot.getFile(parsed.audioFileId);
        const audioUrl = bot.getFileUrl(file.file_path);
        const title = parsed.caption?.split('\n')[0]?.trim() || 'Audio';
        await db(context.env.DB).addAudioBreakdown({
          song_id: 0,
          title,
          file_url: audioUrl,
          duration: 0,
          telegram_message_id: parsed.messageId,
          visible: 1,
        });
        synced++;
      }
    }

    await db(context.env.DB).setSetting('last_sync_at', new Date().toISOString());
    return jsonResponse({ ok: true, data: { synced } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
