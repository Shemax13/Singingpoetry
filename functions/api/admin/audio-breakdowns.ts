import { db } from '../../_utils/db';
import { requireAuth, jsonResponse, handleOptions } from '../../_utils/auth';
import type { Env, AudioBreakdown } from '../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const url = new URL(context.request.url);
    const songId = url.searchParams.get('song_id');
    const breakdowns = await db(context.env.DB).getAudioBreakdowns(songId ? parseInt(songId) : undefined);
    return jsonResponse({ ok: true, data: breakdowns });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const body = await context.request.json<AudioBreakdown>();
    const ab = await db(context.env.DB).addAudioBreakdown(body);
    return jsonResponse({ ok: true, data: ab }, 201);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
