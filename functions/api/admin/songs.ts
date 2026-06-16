import { db } from '../../_utils/db';
import { requireAuth, jsonResponse, handleOptions } from '../../_utils/auth';
import type { Env, Song } from '../../_utils/types';

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const songs = await db(context.env.DB).getSongs(false, 200, 0);
    return jsonResponse({ ok: true, data: songs });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const body = await context.request.json<Partial<Song>>();
    const song = await db(context.env.DB).upsertSong(body as Song);
    return jsonResponse({ ok: true, data: song }, 201);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPut(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const body = await context.request.json<{ ids: number[] }>();
    if (body.ids) {
      await db(context.env.DB).reorderSongs(body.ids);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: false, error: 'Invalid payload' }, 400);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
