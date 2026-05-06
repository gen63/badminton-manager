import { useMemo } from 'react';
import { WinnerSelectModal } from './WinnerSelectModal';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useUnrecordedDismissStore } from '../stores/unrecordedDismissStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useToast } from '../hooks/useToast';
import { pickNextUnrecordedMatchForUser } from '../lib/unrecordedMatchPrompt';

interface Props {
  /** true の時のみ表示。MainPage 側で pendingScoreMatch === null を渡す */
  enabled: boolean;
}

/**
 * 自分が参加した未記録試合 (scoreA===0 && scoreB===0 && !winner) があれば
 * WinnerSelectModal を順次自動表示する。
 *
 * Firestore onSnapshot で matchHistory が更新された瞬間 derived target が
 * 切り替わり、勝者が確定した試合は自動でアンマウントされる
 * (= 他端末で誰かが入力したら自動クローズ)。
 *
 * 動作前提: 試合記録モード (recordScores=true) かつオンラインモード。
 */
export function UnrecordedMatchPrompt({ enabled }: Props) {
  const session = useSessionStore((s) => s.session);
  const currentUser = useSessionStore((s) => s.currentUser);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const players = usePlayerStore((s) => s.players);
  const recordScores = useSettingsStore((s) => s.recordScores);
  const isGameStateLoaded = useSyncStatusStore((s) => s.isGameStateLoaded);
  const dismissed = useUnrecordedDismissStore((s) => s.dismissed);
  const addDismissed = useUnrecordedDismissStore((s) => s.add);
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);

  const isOnlineMode = !!session?.createdBy;
  const canShow =
    enabled && recordScores && isOnlineMode && !!currentUser && isGameStateLoaded;

  const target = useMemo(() => {
    if (!canShow) return null;
    return pickNextUnrecordedMatchForUser(matchHistory, currentUser, players, dismissed);
  }, [canShow, matchHistory, currentUser, players, dismissed]);

  if (!target) return null;

  const getPlayerName = (id: string) =>
    players.find((p) => p.id === id)?.name || '未設定';
  const getPlayerGender = (id: string) =>
    players.find((p) => p.id === id)?.gender;

  return (
    <WinnerSelectModal
      key={target.id}
      courtId={target.courtId}
      teamA={target.teamA}
      teamB={target.teamB}
      getPlayerName={getPlayerName}
      getPlayerGender={getPlayerGender}
      onConfirm={async (winnerIds) => {
        if (winnerIds === 'unknown') {
          addDismissed(target.id);
          return;
        }
        const teamASet = new Set(target.teamA.filter(Boolean));
        const teamBSet = new Set(target.teamB.filter(Boolean));
        const allInA = winnerIds.every((id) => teamASet.has(id));
        const allInB = winnerIds.every((id) => teamBSet.has(id));
        if (!allInA && !allInB) {
          toast.error('勝者が同じチームではありません。スコアは記録されませんでした');
          addDismissed(target.id);
          return;
        }
        const winner: 'A' | 'B' = allInA ? 'A' : 'B';
        const scoreA = winner === 'A' ? 100 : 99;
        const scoreB = winner === 'B' ? 100 : 99;
        await writer.updateMatchScore(target.id, scoreA, scoreB, winner);
      }}
      onCancel={() => addDismissed(target.id)}
    />
  );
}
