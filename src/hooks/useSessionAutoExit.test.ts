/**
 * useSessionAutoExit の自動退出経路を検証する。
 *
 * React Router / sessionService を mock し、フックをマウントしてタイマーを進めることで、
 * 「最後の試合から30分」での退出・進行中コートでの継続・dev モードでの無効化を確認する。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockLeaveSession = vi.fn(() => Promise.resolve());
const mockClearPresence = vi.fn(() => Promise.resolve());
vi.mock('../services/sessionService', () => ({
  leaveSession: (...args: unknown[]) => mockLeaveSession(...(args as [])),
  clearPresence: (...args: unknown[]) => mockClearPresence(...(args as [])),
}));

import { useSessionAutoExit, AUTO_EXIT_CHECK_INTERVAL_MS } from './useSessionAutoExit';
import { DEV_MODE_CODE } from './useDevMode';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { EMPTY_COURT_STATE, type Court } from '../types/court';
import type { Match } from '../types/match';
import type { Session } from '../types/session';

const NOW = 1_700_000_000_000;

function makeMatch(startedAt: number, finishedAt: number): Match {
  return {
    id: `m-${startedAt}`,
    courtId: 1,
    teamA: ['A1', 'A2'],
    teamB: ['B1', 'B2'],
    scoreA: 21,
    scoreB: 15,
    startedAt,
    finishedAt,
  };
}

function makeCourt(id: number, overrides: Partial<Court> = {}): Court {
  return { id, ...EMPTY_COURT_STATE, ...overrides };
}

function setupSession(matchHistory: Match[], courts: Court[] = [makeCourt(1)]) {
  const session = {
    id: 'ABC123',
    config: { courtCount: 1, targetScore: 21, practiceStartTime: NOW - 4 * 60 * 60 * 1000 },
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'たろう',
  } as Session;
  useSessionStore.setState({ session, currentUser: 'たろう' });
  useGameStore.setState({ matchHistory, courts });
  useSyncStatusStore.setState({ isGameStateLoaded: true });
}

describe('useSessionAutoExit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.removeItem('dev-mode');
    mockNavigate.mockClear();
    mockLeaveSession.mockClear();
    mockClearPresence.mockClear();
  });

  afterEach(() => {
    // ストアを戻す前にアンマウントする（マウント中のフックへ setState が届いて
    // act 警告になるのを防ぐ）
    cleanup();
    vi.useRealTimers();
    useSessionStore.setState({ session: null, currentUser: null });
    useGameStore.setState({ matchHistory: [], courts: [] });
    useSyncStatusStore.setState({ isGameStateLoaded: false });
  });

  it('最後の試合から31分経っていればマウント直後に退出する', () => {
    const finishedAt = NOW - 31 * 60 * 1000;
    setupSession([makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)]);

    renderHook(() => useSessionAutoExit());

    expect(mockLeaveSession).toHaveBeenCalledWith('ABC123', 'たろう');
    expect(mockClearPresence).toHaveBeenCalledWith('ABC123', 'たろう');
    expect(useSessionStore.getState().session).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: {
        notice: {
          type: 'warning',
          message: '練習終了から30分経過したためセッションを退出しました',
        },
      },
    });
  });

  it('最後の試合から29分なら退出せず、30分を過ぎた次の tick で退出する', () => {
    const finishedAt = NOW - 29 * 60 * 1000;
    setupSession([makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)]);

    renderHook(() => useSessionAutoExit());
    expect(mockNavigate).not.toHaveBeenCalled();

    // 60 秒 tick を 2 回進めると最後の試合から 31 分になる
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 2);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockLeaveSession).toHaveBeenCalledWith('ABC123', 'たろう');
  });

  it('コートに試合が進行中なら退出しない', () => {
    const finishedAt = NOW - 3 * 60 * 60 * 1000;
    setupSession(
      [makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)],
      [makeCourt(1, { isPlaying: true, startedAt: NOW - 5 * 60 * 1000 })],
    );

    renderHook(() => useSessionAutoExit());
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 5);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).not.toBeNull();
  });

  it('試合が1件も無ければ退出しない（開始前に入っている人を追い出さない）', () => {
    setupSession([]);

    renderHook(() => useSessionAutoExit());
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 5);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('dev モードでは退出しない', () => {
    localStorage.setItem('dev-mode', DEV_MODE_CODE);
    const finishedAt = NOW - 3 * 60 * 60 * 1000;
    setupSession([makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)]);

    renderHook(() => useSessionAutoExit());
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 5);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('gameState 初回受信前は判定しない', () => {
    const finishedAt = NOW - 3 * 60 * 60 * 1000;
    setupSession([makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)]);
    useSyncStatusStore.setState({ isGameStateLoaded: false });

    renderHook(() => useSessionAutoExit());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('セッション未選択では何もしない', () => {
    useSessionStore.setState({ session: null, currentUser: null });
    useSyncStatusStore.setState({ isGameStateLoaded: true });

    renderHook(() => useSessionAutoExit());
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 5);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockLeaveSession).not.toHaveBeenCalled();
  });

  it('退出は1回だけで、以降の tick で重複しない', () => {
    const finishedAt = NOW - 31 * 60 * 1000;
    setupSession([makeMatch(finishedAt - 10 * 60 * 1000, finishedAt)]);

    renderHook(() => useSessionAutoExit());
    act(() => {
      vi.advanceTimersByTime(AUTO_EXIT_CHECK_INTERVAL_MS * 5);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockLeaveSession).toHaveBeenCalledTimes(1);
  });
});
