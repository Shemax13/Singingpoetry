import { db } from '../../_utils/db';
import { jsonResponse } from '../../_utils/auth';
import type { Env } from '../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env; params: { id: string } }): Promise<Response> {
  try {
    const id = parseInt(context.params.id);
    const song = await db(context.env.DB).getSong(id);
    if (!song) return jsonResponse({ ok: false, error: 'Song not found' }, 404);
    const breakdowns = await db(context.env.DB).getAudioBreakdowns(id);
    return jsonResponse({ ok: true, data: { ...song, audio_breakdowns: breakdowns } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}
