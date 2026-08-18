import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FinishOperationGuide } from './FinishOperationGuide';
import type { Court } from '../types/court';
import { EMPTY_COURT_STATE } from '../types/court';
import type { Player } from '../types/player';

const emptyCourt = (id: number): Court => ({ id, ...EMPTY_COURT_STATE, restingPlayerIds: [] });

const playingCourt = (
  id: number,
  startedAt: number,
  teamA: [string, string] = ['p1', 'p2'],
  teamB: [string, string] = ['p3', 'p4'],
): Court => ({
  id,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  isPlaying: true,
  startedAt,
  finishedAt: 0,
  restingPlayerIds: [],
});

const player = (id: string, name: string): Player => ({
  id,
  name,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
});

const waitingPlayers = [player('w1', 'たろう'), player('w2', 'はなこ')];

/** data-phase を持つガイド要素。未表示なら null */
function guide(): HTMLElement | null {
  return document.querySelector('[data-phase]');
}

describe('FinishOperationGuide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('プレイ中コートが無ければ何も描画しない', () => {
    render(
      <FinishOperationGuide
        courts={[emptyCourt(1), emptyCourt(2)]}
        certainIds={new Set(['w1', 'w2'])}
        players={waitingPlayers}
        selfPlayerId={null}
        showCourtNumber
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(guide()).toBeNull();
  });

  it('4:30 未満は担当だけ示し、4:30 で「Nコート脇で」に変わる', () => {
    render(
      <FinishOperationGuide
        courts={[playingCourt(1, Date.now() - 60_000), playingCourt(2, Date.now())]}
        certainIds={new Set(['w1', 'w2'])}
        players={waitingPlayers}
        selfPlayerId={null}
        showCourtNumber
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(guide()).toHaveAttribute('data-phase', 'waiting');
    expect(screen.getByText('終了操作をお願いします')).toBeInTheDocument();
    expect(screen.getByText('たろう')).toBeInTheDocument();
    expect(screen.getByText('はなこ')).toBeInTheDocument();

    act(() => {
      // 経過最大はコート1（既に1分経過）なので、残り 3分30秒 + タイマーの余裕分
      vi.advanceTimersByTime(3.5 * 60 * 1000 + 100);
    });
    expect(guide()).toHaveAttribute('data-phase', 'imminent');
    expect(screen.getByText('1コート脇で終了操作をお願いします')).toBeInTheDocument();
  });

  it('1面運用ではコート番号を出さない', () => {
    render(
      <FinishOperationGuide
        courts={[playingCourt(1, Date.now() - 5 * 60 * 1000)]}
        certainIds={new Set(['w1'])}
        players={waitingPlayers}
        selfPlayerId={null}
        showCourtNumber={false}
      />,
    );
    expect(screen.getByText('コート脇で終了操作をお願いします')).toBeInTheDocument();
  });

  it('自分が担当なら枠を強調し自分のチップを塗る', () => {
    render(
      <FinishOperationGuide
        courts={[playingCourt(1, Date.now() - 5 * 60 * 1000)]}
        certainIds={new Set(['w1', 'w2'])}
        players={waitingPlayers}
        selfPlayerId="w2"
        showCourtNumber
      />,
    );
    expect(guide()?.className).toContain('ring-orange-400');
    expect(screen.getByText('はなこ').className).toContain('bg-orange-600');
    expect(screen.getByText('たろう').className).not.toContain('bg-orange-600');
  });

  it('対象が全員コートに乗ったら消える', () => {
    render(
      <FinishOperationGuide
        courts={[playingCourt(1, Date.now(), ['w1', 'w2'], ['p3', 'p4'])]}
        certainIds={new Set(['w1', 'w2'])}
        players={waitingPlayers}
        selfPlayerId="w2"
        showCourtNumber
      />,
    );
    expect(guide()).toBeNull();
  });
});
