import { db } from '../../_utils/db';
import { requireAuth, jsonResponse, handleOptions } from '../../_utils/auth';
import type { Env } from '../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const keys = ['about_text_ru', 'about_text_en', 'site_language', 'songs_per_page', 'last_sync_at'];
    const settings: Record<string, string> = {};
    for (const key of keys) {
      const val = await db(context.env.DB).getSetting(key);
      if (val !== null) settings[key] = val;
    }
    return jsonResponse({ ok: true, data: settings });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const body = await context.request.json<Record<string, string>>();
    for (const [key, value] of Object.entries(body)) {
      await db(context.env.DB).setSetting(key, value);
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
