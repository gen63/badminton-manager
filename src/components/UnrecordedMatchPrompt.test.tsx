import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UnrecordedMatchPrompt } from './UnrecordedMatchPrompt';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useUnrecordedDismissStore } from '../stores/unrecordedDismissStore';
import type { Match } from '../types/match';
import type { Player } from '../types/player';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../hooks/useSessionWriterToast', () => ({
  useSessionWriterWithToast: () => ({
    updateMatchScore: vi.fn(),
    updateMatch: vi.fn(),
  }),
}));

const player = (id: string, name: string): Player =>
  ({ id, name, gender: 'M' } as Player);

const unrecorded: Match = {
  id: 'm1',
  courtId: 1,
  teamA: ['p1', 'p2'],
  teamB: ['p3', 'p4'],
  scoreA: 0,
  scoreB: 0,
  startedAt: 0,
  finishedAt: 0,
};

const renderPrompt = () =>
  render(
    <MemoryRouter>
      <UnrecordedMatchPrompt />
    </MemoryRouter>,
  );

describe('UnrecordedMatchPrompt - 入力方式による分岐', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useUnrecordedDismissStore.getState().clear();
    useGameStore.setState({ matchHistory: [unrecorded] });
    usePlayerStore.setState({
      players: [player('p1', '太郎'), player('p2', '次郎'), player('p3', '三郎'), player('p4', '四郎')],
    });
    useSessionStore.setState({
      session: { id: 'sess01' } as never,
      currentUser: '太郎',
    });
    useSyncStatusStore.setState({ isGameStateLoaded: true });
    useSettingsStore.setState({ recordScores: true, matchResultInputMode: 'simple' });
  });

  it('simple（既定）では WinnerSelectModal を表示し、遷移しない', () => {
    renderPrompt();
    expect(screen.getByText('不明')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('score では点数入力ページへ遷移し、モーダルは出さない', () => {
    useSettingsStore.setState({ matchResultInputMode: 'score' });
    renderPrompt();
    expect(screen.queryByText('不明')).not.toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith('/score/m1', { state: { from: '/main' } });
  });

  it('score で遷移した試合はスヌーズされ、再マウントしても再遷移しない', () => {
    useSettingsStore.setState({ matchResultInputMode: 'score' });
    renderPrompt();
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(useUnrecordedDismissStore.getState().dismissedUntil['m1']).toBeGreaterThan(Date.now());

    navigateMock.mockClear();
    renderPrompt();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('recordScores が OFF なら何も出さず遷移もしない', () => {
    useSettingsStore.setState({ recordScores: false, matchResultInputMode: 'score' });
    renderPrompt();
    expect(screen.queryByText('不明')).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
