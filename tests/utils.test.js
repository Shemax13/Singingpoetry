import { describe, it, expect } from 'vitest';
import {
  safeInt,
  genToken,
  firstLine,
  sunoExtractUrls,
  parseMsgFull,
} from '../src/utils.js';

describe('safeInt', () => {
  it('parses valid integers', () => {
    expect(safeInt('123', 0)).toBe(123);
    expect(safeInt('0', 42)).toBe(0);
    expect(safeInt('-5', 0)).toBe(-5);
  });
  it('returns default for invalid input', () => {
    expect(safeInt('abc', 10)).toBe(10);
    expect(safeInt(null, 10)).toBe(10);
    expect(safeInt(undefined, 10)).toBe(10);
    expect(safeInt('', 10)).toBe(10);
  });
});

describe('genToken', () => {
  it('generates a 64-char hex string', () => {
    const t = genToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it('generates different tokens each call', () => {
    const t1 = genToken();
    const t2 = genToken();
    expect(t1).not.toBe(t2);
  });
});

describe('firstLine', () => {
  it('returns first line of caption', () => {
    expect(firstLine('Hello\nWorld')).toBe('Hello');
  });
  it('returns Untitled for empty input', () => {
    expect(firstLine('')).toBe('Untitled');
    expect(firstLine(null)).toBe('Untitled');
    expect(firstLine(undefined)).toBe('Untitled');
  });
  it('trims whitespace', () => {
    expect(firstLine('  Hello  \nWorld')).toBe('Hello');
  });
});

describe('sunoExtractUrls', () => {
  it('extracts suno.com/s/ URLs', () => {
    const urls = sunoExtractUrls('Check out https://suno.com/s/abc123');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://suno.com/s/abc123');
  });
  it('extracts suno.com/song/ URLs', () => {
    const urls = sunoExtractUrls('Listen: https://suno.com/song/abc-def-123');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://suno.com/song/abc-def-123');
  });
  it('extracts URLs without protocol', () => {
    const urls = sunoExtractUrls('suno.com/s/xyz789');
    expect(urls).toHaveLength(1);
  });
  it('deduplicates URLs', () => {
    const urls = sunoExtractUrls('https://suno.com/s/abc https://suno.com/s/abc');
    expect(urls).toHaveLength(1);
  });
  it('returns empty array for no URLs', () => {
    expect(sunoExtractUrls('No suno here')).toEqual([]);
    expect(sunoExtractUrls(null)).toEqual([]);
  });
});

describe('parseMsgFull', () => {
  it('parses a text message', () => {
    const result = parseMsgFull({
      message: {
        message_id: 42,
        date: 1700000000,
        text: 'Hello world',
        chat: { id: 123, type: 'private' },
      },
    });
    expect(result.tg_msg_id).toBe(42);
    expect(result.text_content).toBe('Hello world');
    expect(result.chat_type).toBe('private');
    expect(result.msg_type).toBe('text');
  });

  it('parses a video message', () => {
    const result = parseMsgFull({
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: -100, type: 'channel' },
        video: { file_id: 'video123', file_unique_id: 'vid123' },
      },
    });
    expect(result.msg_type).toBe('video');
    expect(result.file_id).toBe('video123');
  });

  it('parses forwarded messages', () => {
    const result = parseMsgFull({
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 456, type: 'group' },
        text: 'Forwarded',
        forward_from_chat: { id: -100, type: 'channel', username: 'mychannel' },
        forward_from_message_id: 99,
      },
    });
    expect(result.forward_from_chat_id).toBe('@mychannel');
    expect(result.forward_from_msg_id).toBe(99);
  });

  it('returns null for invalid input', () => {
    expect(parseMsgFull(null)).toBeNull();
    expect(parseMsgFull({})).toBeNull();
  });
});
