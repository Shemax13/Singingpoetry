import { db } from '../../../_utils/db';
import { jsonResponse } from '../../../_utils/auth';
import type { Env } from '../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env; params: { id: string } }): Promise<Response> {
  try {
    const id = parseInt(context.params.id);
    const next = await db(context.env.DB).getNextSong(id);
    if (!next) return jsonResponse({ ok: false, error: 'No next song' }, 404);
    return jsonResponse({ ok: true, data: next });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}
