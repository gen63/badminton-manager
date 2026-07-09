import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendMatchesToSheets } from './sheetsApi';
import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { Session } from '../types/session';

const players: Player[] = [
  { id: 'p1', name: '太郎' },
  { id: 'p2', name: '次郎' },
  { id: 'p3', name: '三郎' },
  { id: 'p4', name: '四郎' },
] as Player[];

const session = {
  id: 'ABC123',
  config: {
    courtCount: 2,
    targetScore: 21,
    practiceStartTime: new Date('2026-07-09T19:00:00').getTime(),
    gym: 'テスト体育館',
  },
  createdAt: 0,
  updatedAt: 0,
} as Session;

function makeMatch(id: string): Match {
  return {
    id,
    courtId: 1,
    teamA: ['p1', 'p2'],
    teamB: ['p3', 'p4'],
    scoreA: 21,
    scoreB: 15,
    startedAt: new Date('2026-07-09T19:00:00').getTime(),
    finishedAt: new Date('2026-07-09T19:12:00').getTime(),
  };
}

describe('sendMatchesToSheets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('URL未設定ならエラーを返す', async () => {
    const result = await sendMatchesToSheets('', [makeMatch('m1')], players, session);
    expect(result.success).toBe(false);
    expect(result.message).toContain('GAS URL');
  });

  it('試合0件ならエラーを返す', async () => {
    const result = await sendMatchesToSheets('https://gas.example', [], players, session);
    expect(result.success).toBe(false);
    expect(result.message).toContain('送信する試合がありません');
  });

  it('opaqueレスポンスなら成功として件数を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ type: 'opaque' } as Response)
    );
    const result = await sendMatchesToSheets(
      'https://gas.example',
      [makeMatch('m1'), makeMatch('m2')],
      players,
      session
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe('2件の試合を送信しました');
  });

  it('GASの応答が遅くても10秒ではタイムアウトしない（60秒まで待つ）', async () => {
    // signal の abort まで解決しない fetch をスタブし、応答が返らない状況を再現
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
            // 25秒後に応答（GASのコールドスタート相当）
            setTimeout(() => resolve({ type: 'opaque' } as Response), 25000);
          })
      )
    );

    const promise = sendMatchesToSheets(
      'https://gas.example',
      [makeMatch('m1')],
      players,
      session
    );
    await vi.advanceTimersByTimeAsync(25000);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('60秒応答が無ければタイムアウトメッセージを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );

    const promise = sendMatchesToSheets(
      'https://gas.example',
      [makeMatch('m1')],
      players,
      session
    );
    await vi.advanceTimersByTimeAsync(60000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('タイムアウト');
    expect(result.message).toContain('再送信しても重複しません');
  });

  it('ネットワークエラーなら接続確認メッセージを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const result = await sendMatchesToSheets(
      'https://gas.example',
      [makeMatch('m1')],
      players,
      session
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('Wi-Fi');
  });
});
