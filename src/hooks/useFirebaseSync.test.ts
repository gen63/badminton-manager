/**
 * useFirebaseSync の onSnapshot 経路を検証する。
 *
 * Firestore SDK と React Router を mock し、`useFirebaseSync` をマウントして
 * `onSnapshot` callback を直接呼び出すことで、`gameState` 反映 / TTL / セッション
 * 削除通知 / 設定の action 経由反映を確認する。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- Firestore mocks ----
type SnapHandler = (snap: {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
}) => void;

let capturedSnapHandler: SnapHandler | null = null;
const mockUnsub = vi.fn();
const mockOnSnapshot = vi.fn(
  (_ref: unknown, onNext: SnapHandler) => {
    capturedSnapHandler = onNext;
    return mockUnsub;
  },
);

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn(() => ({ __docRef: true })),
    onSnapshot: (ref: unknown, onNext: SnapHandler) => mockOnSnapshot(ref, onNext),
    // TTL テストで sessionService.deleteSession 経由で deleteDoc が呼ばれる
    deleteDoc: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
}));

// React Router の useNavigate を mock
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// 通知関数を mock
const mockNotifyMatchStart = vi.fn();
vi.mock('../lib/notifications', () => ({
  notifyMatchStart: (...args: unknown[]) => mockNotifyMatchStart(...args),
}));

import { useFirebaseSync } from './useFirebaseSync';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';

const SESSION_ID = 'sess-1';
const NOW = 1_700_000_000_000;

function setSharedSession(overrides: Partial<{ updatedAt: number; createdBy: string }> = {}) {
  useSessionStore.setState({
    session: {
      id: SESSION_ID,
      config: { courtCount: 2, targetScore: 21, practiceStartTime: NOW - 3_600_000 },
      createdAt: NOW - 3_600_000,
      updatedAt: overrides.updatedAt ?? NOW,
      createdBy: overrides.createdBy ?? 'creator',
      participants: ['creator'],
    },
    currentUser: 'creator',
  });
}

function emit(data: Record<string, unknown> | undefined) {
  if (!capturedSnapHandler) throw new Error('onSnapshot handler not captured');
  capturedSnapHandler({
    exists: () => data !== undefined,
    data: () => data,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  capturedSnapHandler = null;
  mockOnSnapshot.mockClear();
  mockUnsub.mockClear();
  mockNavigate.mockClear();
  mockNotifyMatchStart.mockClear();
  // ストアをリセット
  useSessionStore.setState({ session: null, currentUser: null });
  usePlayerStore.setState({ players: [] });
  useGameStore.setState({ courts: [], matchHistory: [] });
  useReservationStore.setState({ reservations: [] });
  useSettingsStore.setState({
    recordScores: true,
    continuousMatchMode: true,
    practiceType: '複',
    prioritizeDiversity: false,
  });
  useSyncStatusStore.setState({ isGameStateLoaded: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFirebaseSync - onSnapshot direct setState', () => {
  it('共有セッションでマウントすると onSnapshot を購読し、初期は loading=false', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(useSyncStatusStore.getState().isGameStateLoaded).toBe(false);
  });

  it('受信したらストアを上書きし loaded=true', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [
            { id: 'p1', name: 'Alice', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
          ],
          courts: [{ id: 1, teamA: ['', ''], teamB: ['', ''], scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0 }],
          matchHistory: [],
          reservations: [],
        },
      });
    });

    expect(usePlayerStore.getState().players).toHaveLength(1);
    expect(useGameStore.getState().courts).toHaveLength(1);
    expect(useSyncStatusStore.getState().isGameStateLoaded).toBe(true);
  });

  it('セッション未選択では loading=true で即返す（subscribe しない）', () => {
    useSessionStore.setState({ session: null, currentUser: null });
    renderHook(() => useFirebaseSync());

    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(useSyncStatusStore.getState().isGameStateLoaded).toBe(true);
  });
});

describe('useFirebaseSync - settings 反映の副作用', () => {
  it("practiceType '楽' 受信で prioritizeDiversity=true まで連動する", () => {
    setSharedSession();
    useSettingsStore.setState({ practiceType: '複', prioritizeDiversity: false });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [],
          courts: [],
          matchHistory: [],
          reservations: [],
          settings: { practiceType: '楽' },
        },
      });
    });

    expect(useSettingsStore.getState().practiceType).toBe('楽');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(true);
  });

  it("practiceType '単' 受信で prioritizeDiversity=false に矯正される", () => {
    setSharedSession();
    useSettingsStore.setState({ practiceType: '複', prioritizeDiversity: true });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '単' },
        },
      });
    });

    expect(useSettingsStore.getState().practiceType).toBe('単');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(false);
  });

  it('同じ practiceType の場合は action を呼ばない（無駄な setState を避ける）', () => {
    setSharedSession();
    useSettingsStore.setState({ practiceType: '楽', prioritizeDiversity: true });
    renderHook(() => useFirebaseSync());

    // act 前に prioritizeDiversity を意図的に false にしておき、
    // 受信時に setPracticeType が呼ばれないなら矯正されないことを確認
    useSettingsStore.setState({ prioritizeDiversity: false });

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '楽' },
        },
      });
    });

    // setPracticeType が呼ばれていないので prioritizeDiversity は手動で書き換えた false のまま
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(false);
  });
});

describe('useFirebaseSync - session-level fields (H1 統合)', () => {
  it('config / participants / accounting / information を sessionStore に反映する', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        config: { courtCount: 3, targetScore: 21, practiceStartTime: NOW - 1000 },
        participants: ['Alice', 'Bob'],
        accounting: { maleFee: 800, femaleFee: 600 },
      });
    });

    const session = useSessionStore.getState().session;
    expect(session?.config.courtCount).toBe(3);
    expect(session?.participants).toEqual(['Alice', 'Bob']);
    expect(session?.accounting?.maleFee).toBe(800);
  });

  it('information の readBy 未定義時は空配列にフォールバック', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        information: { text: 'hello', updatedAt: NOW, updatedBy: 'Alice' },
      });
    });

    const info = useSessionStore.getState().session?.information;
    expect(info?.text).toBe('hello');
    expect(info?.readBy).toEqual([]);
  });
});

describe('useFirebaseSync - 同一値 setState スキップ (H3)', () => {
  it('同じ players 配列を再受信しても setState を発火しない', () => {
    setSharedSession();
    const initialPlayers = [
      { id: 'p1', name: 'Alice', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
    ];
    usePlayerStore.setState({ players: initialPlayers });

    let setStateCount = 0;
    const unsubSpy = usePlayerStore.subscribe(() => {
      setStateCount += 1;
    });

    renderHook(() => useFirebaseSync());

    // 構造的に等しいが参照は別の配列を送る
    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: JSON.parse(JSON.stringify(initialPlayers)),
          courts: [],
          matchHistory: [],
          reservations: [],
        },
      });
    });

    expect(setStateCount).toBe(0);
    unsubSpy();
  });
});

describe('useFirebaseSync - 欠損フィールドのガード', () => {
  it('reservations が undefined の remote document はローカル reservations を変えない', () => {
    setSharedSession();
    useReservationStore.setState({
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [],
          courts: [],
          matchHistory: [],
          // reservations フィールド無し（古いスキーマ）
        },
      });
    });

    expect(useReservationStore.getState().reservations).toHaveLength(1);
  });

  it('gameState 自体が無くても loaded=true', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({ updatedAt: NOW });
    });

    expect(useSyncStatusStore.getState().isGameStateLoaded).toBe(true);
  });
});

describe('useFirebaseSync - 削除 / TTL', () => {
  it('snap.exists()=false でセッションをクリアし root へ navigate', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit(undefined);
    });

    expect(useSessionStore.getState().session).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('updatedAt が 30 日以上前なら有効期限切れ通知 → navigate', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW - 31 * 24 * 60 * 60 * 1000,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
        },
      });
    });

    expect(useSessionStore.getState().session).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
