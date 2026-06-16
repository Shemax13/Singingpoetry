import { db } from '../_utils/db';
import { jsonResponse } from '../_utils/auth';
import type { Env } from '../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const keys = ['about_text_ru', 'about_text_en', 'site_language'];
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
