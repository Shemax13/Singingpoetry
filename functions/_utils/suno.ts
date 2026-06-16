const OPENSUNO_API = 'https://opensuno.vercel.app';

interface SunoTrackData {
  id: string;
  suno_url: string;
  mp3_url: string;
  cover_url: string;
  cover_png: string;
  download: {
    mp3: string;
    cover_jpg: string;
    cover_png: string;
  };
  title: string;
  artist: string;
  tags: string;
  duration: number;
}

export interface SunoResult {
  title: string;
  audioUrl: string;
  coverUrl: string;
  duration: number;
  trackUrl: string;
}

export async function fetchSunoTrack(sunoUrl: string): Promise<SunoResult | null> {
  try {
    const url = `${OPENSUNO_API}/track?url=${encodeURIComponent(sunoUrl)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json<{ status: string; data: SunoTrackData }>();
    if (data.status !== 'ok' || !data.data) return null;
    const track = data.data;
    return {
      title: track.title || 'Untitled',
      audioUrl: track.mp3_url || track.download?.mp3 || '',
      coverUrl: track.cover_url || track.cover_png || track.download?.cover_jpg || track.download?.cover_png || '',
      duration: track.duration || 0,
      trackUrl: track.suno_url || sunoUrl,
    };
  } catch {
    return null;
  }
}

export function parseSunoUrl(input: string): string | null {
  const patterns = [
    /suno\.com\/song\/([a-f0-9-]+)/i,
    /suno\.com\/s\/([a-zA-Z0-9]+)/i,
    /suno\.com\/@\w+\/([a-f0-9-]+)/i,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return `https://suno.com/song/${m[1]}`;
  }
  if (input.startsWith('http') && input.includes('suno.com')) return input;
  return null;
}
