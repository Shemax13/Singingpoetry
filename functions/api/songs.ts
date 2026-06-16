import { db } from '../_utils/db';
import { jsonResponse, corsHeaders } from '../_utils/auth';
import type { Env } from '../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  try {
    const songs = await db(context.env.DB).getSongs(true, limit, offset);
    return jsonResponse({ ok: true, data: songs });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}
