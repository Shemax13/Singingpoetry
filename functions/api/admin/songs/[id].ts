import { db } from '../../../_utils/db';
import { requireAuth, jsonResponse, handleOptions } from '../../../_utils/auth';
import type { Env } from '../../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env; params: { id: string } }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const id = parseInt(context.params.id);
    const song = await db(context.env.DB).getSong(id);
    if (!song) return jsonResponse({ ok: false, error: 'Not found' }, 404);
    const breakdowns = await db(context.env.DB).getAudioBreakdowns(id);
    return jsonResponse({ ok: true, data: { ...song, audio_breakdowns: breakdowns } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestDelete(context: { request: Request; env: Env; params: { id: string } }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const id = parseInt(context.params.id);
    await db(context.env.DB).deleteSong(id);
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPut(context: { request: Request; env: Env; params: { id: string } }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const id = parseInt(context.params.id);
    const body = await context.request.json<Record<string, unknown>>();
    const song = await db(context.env.DB).upsertSong({ ...body, id } as never);
    return jsonResponse({ ok: true, data: song });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
