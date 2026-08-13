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
const mockNotifyForcedRest = vi.fn();
vi.mock('../lib/notifications', () => ({
  notifyForcedRest: (...args: unknown[]) => mockNotifyForcedRest(...args),
}));

import { useFirebaseSync } from './useFirebaseSync';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useNoticeStore } from '../stores/noticeStore';

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
  mockNotifyForcedRest.mockClear();
  useNoticeStore.setState({ notices: [] });
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
  useSyncStatusStore.setState({ isGameStateLoaded: false, reconnectNonce: 0, syncError: null });
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

  it('reservationBlockThreshold をリモートからストアにミラーする', () => {
    setSharedSession();
    useSettingsStore.setState({ reservationBlockThreshold: 2 });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '複', reservationBlockThreshold: 3 },
        },
      });
    });

    expect(useSettingsStore.getState().reservationBlockThreshold).toBe(3);
  });

  it('reservationBlockThreshold 未設定の受信ではデフォルト(2)に矯正される', () => {
    setSharedSession();
    useSettingsStore.setState({ reservationBlockThreshold: 3 });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '複' },
        },
      });
    });

    expect(useSettingsStore.getState().reservationBlockThreshold).toBe(2);
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

  it('settings.continuousMatchMode 未設定の受信ではローカルが false に同期される', () => {
    // フィールド欠損セッションで UI トグルが ON 表示のままだと、
    // finishMatchAndContinue の `?? false` と食い違うため、表示側を実効値に揃える
    setSharedSession();
    useSettingsStore.setState({ continuousMatchMode: true });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '複' },
        },
      });
    });

    expect(useSettingsStore.getState().continuousMatchMode).toBe(false);
  });

  it('settings.continuousMatchMode=true の受信でローカルに反映される', () => {
    setSharedSession();
    useSettingsStore.setState({ continuousMatchMode: false });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          settings: { practiceType: '複', continuousMatchMode: true },
        },
      });
    });

    expect(useSettingsStore.getState().continuousMatchMode).toBe(true);
  });

  it('settings.practiceType 未設定 + config.gameMode 未設定では端末ローカル "単" を "複" に矯正する', () => {
    // 旧セッション等で gameState.settings.practiceType が無い場合、前セッションから
    // 持ち越した端末ローカル '単' が gameMode に流出すると、ダブルス練習でも
    // assignCourts がシングルスフローを走らせて 2 人しか配置されない不具合になる。
    setSharedSession();
    useSettingsStore.setState({ practiceType: '単', prioritizeDiversity: false });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
          // settings 自体が無い
        },
      });
    });

    expect(useSettingsStore.getState().practiceType).toBe('複');
  });

  it('settings.practiceType 未設定でも config.gameMode=singles なら "単" を維持', () => {
    setSharedSession();
    useSettingsStore.setState({ practiceType: '複', prioritizeDiversity: false });
    renderHook(() => useFirebaseSync());

    act(() => {
      emit({
        updatedAt: NOW,
        config: { courtCount: 1, targetScore: 21, practiceStartTime: NOW, gameMode: 'singles' },
        gameState: {
          players: [], courts: [], matchHistory: [], reservations: [],
        },
      });
    });

    expect(useSettingsStore.getState().practiceType).toBe('単');
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

describe('useFirebaseSync - 再購読 (reconnect)', () => {
  it('reconnectNonce を increment すると再購読する (unsub → 新 subscribe)', () => {
    setSharedSession();
    const { rerender } = renderHook(() => useFirebaseSync());

    // 初回 subscribe
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUnsub).not.toHaveBeenCalled();

    // requestReconnect で nonce が +1
    act(() => {
      useSyncStatusStore.getState().requestReconnect();
    });
    rerender();

    expect(mockUnsub).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
  });

  it('再購読時に既存の syncError をクリアする (banner が消える)', () => {
    setSharedSession();
    const { rerender } = renderHook(() => useFirebaseSync());

    act(() => {
      useSyncStatusStore.getState().setSyncError('test error');
    });
    expect(useSyncStatusStore.getState().syncError).toBe('test error');

    act(() => {
      useSyncStatusStore.getState().requestReconnect();
    });
    rerender();

    expect(useSyncStatusStore.getState().syncError).toBeNull();
  });
});

describe('useFirebaseSync - 削除 / TTL', () => {
  it('snap.exists()=false でセッションをクリアし即時 root へ navigate（notice 付き）', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() => {
      emit(undefined);
    });

    expect(useSessionStore.getState().session).toBeNull();
    // setTimeout 無しで即時 navigate される
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: { notice: { type: 'error', message: 'セッションが削除されました' } },
    });
  });

  it('updatedAt が 30 日以上前なら即時 navigate（warning notice 付き）', () => {
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
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: {
        notice: {
          type: 'warning',
          message: 'セッションの有効期限（最終アクセスから1か月）が切れました',
        },
      },
    });
  });
});

describe('useFirebaseSync - 未対応強制休憩の全員通知', () => {
  const emptyGameStateBase = {
    courts: [],
    matchHistory: [],
    reservations: [],
  };

  const forcedRestPlayer = (
    id: string,
    name: string,
    forcedRestAt: number,
    operationStatus = { payment: false, roster: true, checkin: true },
  ) => ({
    id,
    name,
    isResting: true,
    gamesPlayed: 1,
    lastPlayedAt: 0,
    activatedAt: 0,
    operationStatus,
    forcedRestAt,
  });

  it('forcedRestAt が新規セットされたらトースト + Notification を出し、再受信では重複しない', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    const snapshot = {
      updatedAt: NOW,
      gameState: {
        ...emptyGameStateBase,
        players: [forcedRestPlayer('fr1', 'Alice', NOW - 1000)],
      },
    };
    act(() => emit(snapshot));

    const notices = useNoticeStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: 'warning',
      message: 'Aliceさんは会費の支払いが未対応のため休憩になりました',
    });
    expect(mockNotifyForcedRest).toHaveBeenCalledTimes(1);

    // 同じスナップショットを再受信しても再通知しない
    act(() => emit(snapshot));
    expect(useNoticeStore.getState().notices).toHaveLength(1);
    expect(mockNotifyForcedRest).toHaveBeenCalledTimes(1);
  });

  it('会費・名簿の両方が未対応なら両方を文言に含める', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          ...emptyGameStateBase,
          players: [
            forcedRestPlayer('fr2', 'Bob', NOW - 2000, {
              payment: false,
              roster: false,
              checkin: true,
            }),
          ],
        },
      }),
    );

    expect(useNoticeStore.getState().notices[0].message).toBe(
      'Bobさんは会費の支払いと名簿の記入が未対応のため休憩になりました',
    );
  });

  it('本人（currentUser）には対応をお願いする文言を出す', () => {
    setSharedSession();
    useSessionStore.setState({ currentUser: 'Carol' });
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          ...emptyGameStateBase,
          players: [forcedRestPlayer('fr3', 'Carol', NOW - 3000)],
        },
      }),
    );

    expect(useNoticeStore.getState().notices[0].message).toBe(
      '会費の支払いがまだのため、休憩になりました。対応後に休憩を解除してください',
    );
  });

  it('2 分以上前の forcedRestAt は通知しない（リロード時の誤通知防止）', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          ...emptyGameStateBase,
          players: [forcedRestPlayer('fr4', 'Dave', NOW - 3 * 60_000)],
        },
      }),
    );

    expect(useNoticeStore.getState().notices).toHaveLength(0);
    expect(mockNotifyForcedRest).not.toHaveBeenCalled();
  });
});

describe('useFirebaseSync - 結果未登録試合の強制休憩通知', () => {
  const participants = [
    { id: 'p1', name: 'Alice', isResting: true, gamesPlayed: 1, lastPlayedAt: 0, activatedAt: 0 },
    { id: 'p2', name: 'Bob', isResting: true, gamesPlayed: 1, lastPlayedAt: 0, activatedAt: 0 },
    { id: 'p3', name: 'Carol', isResting: true, gamesPlayed: 1, lastPlayedAt: 0, activatedAt: 0 },
    { id: 'p4', name: 'Dave', isResting: true, gamesPlayed: 1, lastPlayedAt: 0, activatedAt: 0 },
  ];

  const unrecordedRestMatch = (id: string, forcedRestAt: number) => ({
    id,
    courtId: 1,
    teamA: ['p1', 'p2'],
    teamB: ['p3', 'p4'],
    scoreA: 0,
    scoreB: 0,
    startedAt: NOW - 30 * 60_000,
    finishedAt: NOW - 15 * 60_000,
    forcedRestAt,
  });

  it('match.forcedRestAt が新規セットされたら出場者名入りのトーストを出し、再受信では重複しない', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    const snapshot = {
      updatedAt: NOW,
      gameState: {
        players: participants,
        courts: [],
        matchHistory: [unrecordedRestMatch('ur1', NOW - 1000)],
        reservations: [],
      },
    };
    act(() => emit(snapshot));

    const notices = useNoticeStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: 'warning',
      message:
        'Aliceさん・Bobさん・Carolさん・Daveさんは試合結果が未登録のため休憩になりました',
    });
    expect(mockNotifyForcedRest).toHaveBeenCalledTimes(1);

    act(() => emit(snapshot));
    expect(useNoticeStore.getState().notices).toHaveLength(1);
    expect(mockNotifyForcedRest).toHaveBeenCalledTimes(1);
  });

  it('出場者本人には結果登録をお願いする文言を出す', () => {
    setSharedSession();
    useSessionStore.setState({ currentUser: 'Bob' });
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          players: participants,
          courts: [],
          matchHistory: [unrecordedRestMatch('ur2', NOW - 2000)],
          reservations: [],
        },
      }),
    );

    expect(useNoticeStore.getState().notices[0].message).toBe(
      '出場した試合の結果が未登録のため、休憩になりました。結果の登録をお願いします',
    );
  });

  it('2 分以上前の match.forcedRestAt は通知しない（リロード時の誤通知防止）', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          players: participants,
          courts: [],
          matchHistory: [unrecordedRestMatch('ur3', NOW - 3 * 60_000)],
          reservations: [],
        },
      }),
    );

    expect(useNoticeStore.getState().notices).toHaveLength(0);
    expect(mockNotifyForcedRest).not.toHaveBeenCalled();
  });
});

describe('useFirebaseSync - 未対応強制休憩のまとめ通知', () => {
  const forcedRestPlayer2 = (
    id: string,
    name: string,
    forcedRestAt: number,
    operationStatus = { payment: false, roster: true, checkin: true },
  ) => ({
    id,
    name,
    isResting: true,
    gamesPlayed: 1,
    lastPlayedAt: 0,
    activatedAt: 0,
    operationStatus,
    forcedRestAt,
  });

  it('同時に複数人が対象なら 1 件にまとめて通知する（未対応項目は和集合）', () => {
    setSharedSession();
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          players: [
            forcedRestPlayer2('g1', 'Alice', NOW - 1000),
            forcedRestPlayer2('g2', 'Bob', NOW - 1000, {
              payment: true,
              roster: false,
              checkin: true,
            }),
          ],
          courts: [],
          matchHistory: [],
          reservations: [],
        },
      }),
    );

    const notices = useNoticeStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toBe(
      'Aliceさん・Bobさんは会費の支払いと名簿の記入が未対応のため休憩になりました',
    );
    expect(mockNotifyForcedRest).toHaveBeenCalledTimes(1);
  });

  it('本人が含まれる場合は本人向け 1 件 + 他メンバーまとめ 1 件に分けて出す', () => {
    setSharedSession();
    useSessionStore.setState({ currentUser: 'Alice' });
    renderHook(() => useFirebaseSync());

    act(() =>
      emit({
        updatedAt: NOW,
        gameState: {
          players: [
            forcedRestPlayer2('g3', 'Alice', NOW - 1000),
            forcedRestPlayer2('g4', 'Bob', NOW - 1000),
          ],
          courts: [],
          matchHistory: [],
          reservations: [],
        },
      }),
    );

    const messages = useNoticeStore.getState().notices.map((n) => n.message);
    expect(messages).toEqual([
      '会費の支払いがまだのため、休憩になりました。対応後に休憩を解除してください',
      'Bobさんは会費の支払いが未対応のため休憩になりました',
    ]);
  });
});
