import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { formatTime, copyToClipboard } from '../lib/utils';
import { formatLocalDate } from '../lib/sessionArchive';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { isMatchOfPlayer } from '../lib/matchFilter';
import { Copy, Trash2, Edit3, Clock, Upload, Loader2, History, ChevronDown, ChevronUp, User } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { BottomNav } from '../components/BottomNav';

import type { Match } from '../types/match';

function MatchCard({
  match,
  matchNumber,
  getPlayerName,
  getPlayerRating,
  handleEdit,
  handleDelete,
  recordScores,
  isAdmin,
}: {
  match: Match;
  matchNumber: number;
  getPlayerName: (id: string) => string;
  getPlayerRating: (id: string) => number;
  handleEdit: (id: string) => void;
  handleDelete: (id: string) => void;
  recordScores: boolean;
  isAdmin: boolean;
}) {
  const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
  const isNoScore = match.scoreA === 0 && match.scoreB === 0 && !match.winner;

  const isTeamAWinner = match.winner === 'A';
  const leftTeam = isTeamAWinner ? match.teamA : match.teamB;
  const rightTeam = isTeamAWinner ? match.teamB : match.teamA;
  const leftScore = isTeamAWinner ? match.scoreA : match.scoreB;
  const rightScore = isTeamAWinner ? match.scoreB : match.scoreA;

  const isMatchSingles = match.teamA[1] === '' && match.teamB[1] === '';
  // ペア内の表示順を一定にする: rating 降順、同点は name 昇順、最後に id でタイブレーク
  const sortPairForDisplay = (ids: readonly string[]) =>
    [...ids].sort((a, b) => {
      const ratingDiff = getPlayerRating(b) - getPlayerRating(a);
      if (ratingDiff !== 0) return ratingDiff;
      const nameDiff = getPlayerName(a).localeCompare(getPlayerName(b));
      if (nameDiff !== 0) return nameDiff;
      return a.localeCompare(b);
    });
  const leftNames = isMatchSingles
    ? getPlayerName(leftTeam[0])
    : sortPairForDisplay(leftTeam).map(getPlayerName).join(' ');
  const rightNames = isMatchSingles
    ? getPlayerName(rightTeam[0])
    : sortPairForDisplay(rightTeam).map(getPlayerName).join(' ');

  return (
    <div
      className={`rounded-lg p-2 border ${isNoScore ? 'bg-orange-50 border-orange-300' : 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-100'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
          {matchNumber}
        </span>

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center text-sm gap-1.5 leading-tight">
            <span className="font-bold text-foreground truncate flex-1 min-w-0">
              {leftNames}
            </span>
            <span className="text-muted-foreground font-bold text-[10px] px-1.5 bg-card rounded-full py-0.5 flex-shrink-0">VS</span>
            <span className="text-muted-foreground truncate flex-1 min-w-0">
              {rightNames}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight">
            <span className="flex items-center gap-0.5 whitespace-nowrap">
              <Clock size={11} />
              {formatTime(match.finishedAt)}
            </span>
            <span className="whitespace-nowrap">({duration}分)</span>
            {isNoScore ? (
              <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                未入力
              </span>
            ) : (
              <span className="text-xs font-bold text-foreground bg-card px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                {leftScore} - {rightScore}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-0.5 flex-shrink-0">
          {recordScores && (
            <button
              onClick={() => handleEdit(match.id)}
              aria-label="編集"
              className="p-1 text-muted-foreground hover:text-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 active:scale-[0.98] rounded-full transition-all duration-150 w-7 h-7 flex items-center justify-center"
            >
              <Edit3 size={13} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => handleDelete(match.id)}
              aria-label="削除"
              className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 active:bg-red-100 active:scale-[0.98] rounded-full transition-all duration-150 w-7 h-7 flex items-center justify-center"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchList({
  unscoredMatches,
  scoredMatches,
  getPlayerName,
  getPlayerRating,
  handleEdit,
  handleDelete,
  recordScores,
  isAdmin,
  scoredCollapsed,
  setScoredCollapsed,
}: {
  unscoredMatches: { match: Match; matchNumber: number }[];
  scoredMatches: { match: Match; matchNumber: number }[];
  getPlayerName: (id: string) => string;
  getPlayerRating: (id: string) => number;
  handleEdit: (id: string) => void;
  handleDelete: (id: string) => void;
  recordScores: boolean;
  isAdmin: boolean;
  scoredCollapsed: boolean;
  setScoredCollapsed: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      {/* 未入力の試合（常に表示） */}
      {unscoredMatches.map(({ match, matchNumber }) => (
        <MatchCard
          key={match.id}
          match={match}
          matchNumber={matchNumber}
          getPlayerName={getPlayerName}
          getPlayerRating={getPlayerRating}
          handleEdit={handleEdit}
          handleDelete={handleDelete}
          recordScores={recordScores}
          isAdmin={isAdmin}
        />
      ))}

      {/* 入力済みの試合（折りたたみ可能） */}
      {scoredMatches.length > 0 && (
        <>
          <button
            onClick={() => setScoredCollapsed(!scoredCollapsed)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{
              backgroundColor: '#e0e7ff',
              color: '#3730a3',
            }}
          >
            <span>入力済み（{scoredMatches.length}件）</span>
            {scoredCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          {!scoredCollapsed && scoredMatches.map(({ match, matchNumber }) => (
            <MatchCard
              key={match.id}
              match={match}
              matchNumber={matchNumber}
              getPlayerName={getPlayerName}
              getPlayerRating={getPlayerRating}
              handleEdit={handleEdit}
              handleDelete={handleDelete}
              recordScores={recordScores}
              isAdmin={isAdmin}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const matchHistory = useGameStore((s) => s.matchHistory);
  const players = usePlayerStore((s) => s.players);
  const session = useSessionStore((s) => s.session);
  const isCreator = useSessionStore((s) => s.isCreator);
  const currentUser = useSessionStore((s) => s.currentUser);
  const isAdmin = isCreator();
  const gasWebAppUrl = useSettingsStore((s) => s.gasWebAppUrl);
  const recordScores = useSettingsStore((s) => s.recordScores);
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);
  const [isUploading, setIsUploading] = useState(false);
  const [myMatchesOnly, setMyMatchesOnly] = useState(false);

  // 自分の試合フィルタが使えるのはオンラインモード & currentUser がある時のみ
  const canFilterByMe = !!session?.createdBy && !!currentUser;
  const filterActive = canFilterByMe && myMatchesOnly;

  // 全試合に通し番号を振った後でフィルタを適用（番号は全体基準で安定）
  const { unscoredMatches, scoredMatches } = useMemo(() => {
    const totalCount = matchHistory.length;
    const reversed = [...matchHistory].reverse();
    const unscored: { match: Match; matchNumber: number }[] = [];
    const scored: { match: Match; matchNumber: number }[] = [];
    reversed.forEach((match, reverseIndex) => {
      if (filterActive && !isMatchOfPlayer(match, currentUser, players)) return;
      const matchNumber = totalCount - reverseIndex;
      const isNoScore = match.scoreA === 0 && match.scoreB === 0 && !match.winner;
      if (isNoScore) {
        unscored.push({ match, matchNumber });
      } else {
        scored.push({ match, matchNumber });
      }
    });
    return { unscoredMatches: unscored, scoredMatches: scored };
  }, [matchHistory, filterActive, currentUser, players]);

  // フィルタ適用後の未入力有無で折り畳みを判定（自分視点に合わせる）
  const hasUnscored = unscoredMatches.length > 0;
  const [scoredCollapsed, setScoredCollapsed] = useState(() => hasUnscored);

  useEffect(() => {
    setScoredCollapsed(hasUnscored);
  }, [hasUnscored]);

  if (!session) {
    navigate('/');
    return null;
  }

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const getPlayerRating = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.rating ?? 0;
  };

  const handleEdit = (matchId: string) => {
    navigate(`/score/${matchId}`, { state: { from: '/history' } });
  };

  const handleDelete = async (matchId: string) => {
    await writer.removeMatch(matchId);
  };

  const handleCopyHistory = async () => {
    const dateStr = formatLocalDate(session?.config.practiceStartTime ?? Date.now());
    const gymName = session?.config.gym || '';

    let text = '日付,場所,A選手1,A選手2,B選手1,B選手2,スコアA,スコアB,試合時間\n';
    matchHistory.forEach((match) => {
      const isMatchSingles = match.teamA[1] === '' && match.teamB[1] === '';
      const a1 = getPlayerName(match.teamA[0]);
      const a2 = isMatchSingles ? '' : getPlayerName(match.teamA[1]);
      const b1 = getPlayerName(match.teamB[0]);
      const b2 = isMatchSingles ? '' : getPlayerName(match.teamB[1]);
      const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
      text += `${dateStr},${gymName},${a1},${a2},${b1},${b2},${match.scoreA},${match.scoreB},${duration}\n`;
    });

    const success = await copyToClipboard(text);
    if (!success) {
      toast.error('コピーに失敗しました');
    }
  };

  const handleUpload = async () => {
    if (!session || !gasWebAppUrl || isUploading) return;
    setIsUploading(true);
    try {
      const result = await sendMatchesToSheets(
        gasWebAppUrl,
        matchHistory,
        players,
        session
      );
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-app pb-[calc(60px+env(safe-area-inset-bottom)+1rem)]">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <History size={20} />
            <h1 className="text-lg font-bold">試合履歴</h1>
          </div>
          {gasWebAppUrl && (
            <button
              onClick={handleUpload}
              disabled={isUploading || matchHistory.length === 0}
              aria-label="Sheetsにアップロード"
              className="icon-btn disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </button>
          )}
          <button
            onClick={handleCopyHistory}
            aria-label="コピー"
            className="icon-btn"
            disabled={matchHistory.length === 0}
          >
            <Copy size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-2 pb-4">
        {/* 試合履歴 */}
        <div className="card p-4">
          {matchHistory.length === 0 ? (
            <EmptyState
              icon="🏸"
              title="まだ試合がありません"
              description="メイン画面でゲームを開始すると、ここに履歴が表示されます。"
            />
          ) : (
            <div className="space-y-2">
              {canFilterByMe && (
                <button
                  onClick={() => setMyMatchesOnly((v) => !v)}
                  aria-pressed={myMatchesOnly}
                  aria-label="自分の試合のみ表示"
                  className={`w-full flex items-center justify-center gap-2 px-3 rounded-xl text-sm font-medium transition-colors min-h-[44px] active:scale-[0.98] ${
                    myMatchesOnly
                      ? ''
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                  style={
                    myMatchesOnly
                      ? { backgroundColor: '#e0e7ff', color: '#3730a3' }
                      : undefined
                  }
                >
                  <User size={16} />
                  <span>{myMatchesOnly ? '自分の試合のみ ✓' : '自分の試合のみ'}</span>
                </button>
              )}

              {filterActive && unscoredMatches.length === 0 && scoredMatches.length === 0 ? (
                <EmptyState
                  icon="🔍"
                  title="あなたの試合はまだありません"
                  description="フィルタを解除すると、すべての試合が表示されます。"
                />
              ) : (
                <MatchList
                  unscoredMatches={unscoredMatches}
                  scoredMatches={scoredMatches}
                  getPlayerName={getPlayerName}
                  getPlayerRating={getPlayerRating}
                  handleEdit={handleEdit}
                  handleDelete={handleDelete}
                  recordScores={recordScores}
                  isAdmin={isAdmin}
                  scoredCollapsed={scoredCollapsed}
                  setScoredCollapsed={setScoredCollapsed}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}

      <BottomNav activeTab="history" />
    </div>
  );
}
