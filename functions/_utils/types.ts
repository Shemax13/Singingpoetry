export interface Song {
  id: number;
  telegram_message_id: number | null;
  title: string;
  lyrics: string | null;
  tg_video_url: string | null;
  suno_audio_url: string | null;
  suno_cover_url: string | null;
  suno_track_url: string | null;
  published_at: string | null;
  order_index: number;
  visible: number;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface AudioBreakdown {
  id: number;
  song_id: number;
  title: string;
  file_url: string;
  duration: number;
  telegram_message_id: number | null;
  visible: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface AdminSession {
  id: string;
  created_at: string;
  expires_at: string;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: { last_row_id: number; changes: number };
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<D1Result>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(col?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw(): Promise<unknown[][]>;
}

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_PASSWORD: string;
  SUNO_COOKIE?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
