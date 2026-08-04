import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { formatTime, copyToClipboard } from '../lib/utils';
import { formatLocalDate } from '../lib/sessionArchive';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { updateSession } from '../services/sessionService';
import { isMatchOfPlayer, computePlayerRecord } from '../lib/matchFilter';
import type { PlayerRecord } from '../lib/matchFilter';
import {
  computePerformanceRatings,
  findPerformance,
  BASE_RATING,
} from '../lib/performanceRating';
import type { PlayerPerformance } from '../lib/performanceRating';
import { useDevMode } from '../hooks/useDevMode';
import { Copy, Trash2, Edit3, Clock, Upload, History, ChevronDown, ChevronUp, User, AlertTriangle, BarChart3 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { BottomNav } from '../components/BottomNav';

import type { Match } from '../types/match';

const SHORT_MATCH_WARNING_MESSAGE = '試合時間が短すぎます（操作ミスの可能性）';

/** チームの名前を1人ずつ描画し、絞り込み中のメンバーだけを強調する。 */
function TeamNames({
  playerIds,
  getPlayerName,
  highlightName,
}: {
  playerIds: string[];
  getPlayerName: (id: string) => string;
  highlightName: string | null;
}) {
  return (
    <>
      {playerIds.map((id, i) => {
        const isHighlighted = getPlayerName(id) === highlightName;
        const className = isHighlighted ? 'font-bold text-indigo-600' : undefined;
        return (
          <span key={`${id}-${i}`} className={className}>
            {i > 0 && ' '}
            {getPlayerName(id)}
          </span>
        );
      })}
    </>
  );
}

function MatchCard({
  match,
  matchNumber,
  getPlayerName,
  getPlayerRating,
  handleEdit,
  handleDelete,
  canDelete,
  onShortMatchWarning,
  highlightName,
}: {
  match: Match;
  matchNumber: number;
  getPlayerName: (id: string) => string;
  getPlayerRating: (id: string) => number;
  handleEdit: (id: string) => void;
  handleDelete: (id: string) => void;
  canDelete: boolean;
  onShortMatchWarning: () => void;
  highlightName: string | null;
}) {
  const durationMs = match.finishedAt - match.startedAt;
  const duration = Math.round(durationMs / 60000);
  // 150 秒以下の試合は試合終了ボタンの誤タップ等、操作ミスの可能性が高い
  const isSuspiciouslyShort = durationMs <= 150_000;
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
  const leftIds = isMatchSingles ? [leftTeam[0]] : sortPairForDisplay(leftTeam);
  const rightIds = isMatchSingles ? [rightTeam[0]] : sortPairForDisplay(rightTeam);

  return (
    <div
      className={`rounded-lg p-2 border ${isNoScore ? 'bg-orange-50 border-orange-300' : 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-100'}`}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          {isSuspiciouslyShort && (
            <button
              type="button"
              onClick={onShortMatchWarning}
              title={SHORT_MATCH_WARNING_MESSAGE}
              aria-label={SHORT_MATCH_WARNING_MESSAGE}
              className="flex items-center justify-center text-amber-600 hover:text-amber-700 active:scale-95 w-5 h-5 rounded-full transition-all duration-150"
            >
              <AlertTriangle size={14} />
            </button>
          )}
          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 w-5 h-5 rounded-full flex items-center justify-center">
            {matchNumber}
          </span>
        </div>

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center text-sm gap-1.5 leading-tight">
            <span className="font-bold text-foreground truncate flex-1 min-w-0">
              <TeamNames playerIds={leftIds} getPlayerName={getPlayerName} highlightName={highlightName} />
            </span>
            <span className="text-muted-foreground font-bold text-[10px] px-1.5 bg-card rounded-full py-0.5 flex-shrink-0">VS</span>
            <span className="text-muted-foreground truncate flex-1 min-w-0">
              <TeamNames playerIds={rightIds} getPlayerName={getPlayerName} highlightName={highlightName} />
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
          <button
            onClick={() => handleEdit(match.id)}
            aria-label="編集"
            className="p-1 text-muted-foreground hover:text-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 active:scale-[0.98] rounded-full transition-all duration-150 w-7 h-7 flex items-center justify-center"
          >
            <Edit3 size={13} />
          </button>
          {canDelete && (
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
  canDelete,
  unscoredCollapsed,
  setUnscoredCollapsed,
  scoredCollapsed,
  setScoredCollapsed,
  onShortMatchWarning,
  highlightName,
}: {
  unscoredMatches: { match: Match; matchNumber: number }[];
  scoredMatches: { match: Match; matchNumber: number }[];
  getPlayerName: (id: string) => string;
  getPlayerRating: (id: string) => number;
  handleEdit: (id: string) => void;
  handleDelete: (id: string) => void;
  canDelete: boolean;
  unscoredCollapsed: boolean;
  setUnscoredCollapsed: (v: boolean) => void;
  scoredCollapsed: boolean;
  setScoredCollapsed: (v: boolean) => void;
  onShortMatchWarning: () => void;
  highlightName: string | null;
}) {
  return (
    <div className="space-y-2">
      {/* 未入力の試合（折りたたみ可能。件数バッジは閉じていても常に表示） */}
      {unscoredMatches.length > 0 && (
        <>
          <button
            onClick={() => setUnscoredCollapsed(!unscoredCollapsed)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold transition-colors"
            style={{
              backgroundColor: '#ffedd5',
              color: '#c2410c',
            }}
          >
            <span>未入力（{unscoredMatches.length}件）</span>
            {unscoredCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          {!unscoredCollapsed && unscoredMatches.map(({ match, matchNumber }) => (
            <MatchCard
              key={match.id}
              match={match}
              matchNumber={matchNumber}
              getPlayerName={getPlayerName}
              getPlayerRating={getPlayerRating}
              handleEdit={handleEdit}
              handleDelete={handleDelete}
              canDelete={canDelete}
              onShortMatchWarning={onShortMatchWarning}
              highlightName={highlightName}
            />
          ))}
        </>
      )}

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
              canDelete={canDelete}
              onShortMatchWarning={onShortMatchWarning}
              highlightName={highlightName}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** 期待勝利数との差を「+2.1 / -1.3」の形に整形する。 */
function formatSigned(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}`;
}

function PlayerRecordSummary({
  playerName,
  isSelf,
  record,
  showWinRate,
  performance,
}: {
  playerName: string | null;
  isSelf: boolean;
  record: PlayerRecord;
  // 勝率は作成者または開発モードのときのみ表示する
  showWinRate: boolean;
  // 強さ指標（レート・偏差値など）は開発モードのときのみ。対象外なら null
  performance: PlayerPerformance | null;
}) {
  const label = isSelf ? '自分の成績' : `${playerName} さんの成績`;
  return (
    <div
      className="rounded-xl px-4 py-3 space-y-2"
      style={{ backgroundColor: '#eef2ff', color: '#3730a3' }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm">
          <span className="text-base font-bold">{record.wins}</span>勝{' '}
          <span className="text-base font-bold">{record.losses}</span>敗
        </span>
        {showWinRate && (
          <span className="text-sm">
            勝率{' '}
            <span className="text-base font-bold">
              {record.winRate === null ? '—' : record.winRate}
            </span>
            {record.winRate === null ? '' : '%'}
          </span>
        )}
      </div>

      {performance && (
        <div className="border-t border-indigo-200 pt-2 space-y-1">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="text-sm">
              レート{' '}
              <span className="text-base font-bold">{performance.rating}</span>
            </span>
            <span className="text-sm">
              偏差値{' '}
              <span className="text-base font-bold">
                {performance.deviation.toFixed(1)}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs opacity-90">
            <span>相手平均 {performance.opponentRating}</span>
            {performance.partnerRating !== null && (
              <span>味方平均 {performance.partnerRating}</span>
            )}
            <span>
              期待勝率 {performance.expectedWinRate ?? '—'}% →{' '}
              {performance.winRate ?? '—'}%（
              {formatSigned(performance.winsAboveExpected)}勝）
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 本日の強さランキング（開発モード限定）。
 * 対戦相手・味方の強さを加味したレート順に並べる。単純な勝率順ではないため、
 * 弱い相手にだけ勝った人は上位に来ない。
 */
function PerformanceRanking({
  players,
  ratedMatchCount,
  currentUser,
  selectedName,
  onSelect,
}: {
  players: PlayerPerformance[];
  ratedMatchCount: number;
  currentUser: string | null;
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors"
        style={{ backgroundColor: '#e0e7ff', color: '#3730a3' }}
      >
        <span className="flex items-center gap-2">
          <BarChart3 size={16} />
          強さランキング（{ratedMatchCount}試合から算出）
        </span>
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>

      {!collapsed && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground leading-snug px-1">
            対戦相手と味方の強さを加味した本日限定の推定値です（平均 {BASE_RATING} /
            偏差値 50）。試合数が少ない人ほど平均寄りになります。
          </p>
          {players.map((p, index) => {
            const isSelected = p.name === selectedName;
            return (
              <button
                key={p.name}
                onClick={() => onSelect(p.name)}
                className={`w-full text-left rounded-lg px-2 py-1.5 border transition-colors ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-300'
                    : 'bg-card border-gray-100 hover:bg-gray-50 active:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm font-bold text-foreground">
                    {p.name}
                    {p.name === currentUser && (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        （自分）
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-foreground flex-shrink-0">
                    {p.rating}
                  </span>
                  <span className="text-[11px] text-muted-foreground w-12 text-right flex-shrink-0">
                    偏差 {p.deviation.toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-7 text-[11px] text-muted-foreground">
                  <span className="whitespace-nowrap">
                    {p.wins}勝{p.losses}敗（{p.winRate}%）
                  </span>
                  <span className="whitespace-nowrap">
                    相手平均 {p.opponentRating}
                  </span>
                  <span
                    className={`whitespace-nowrap font-medium ${
                      p.winsAboveExpected > 0
                        ? 'text-emerald-600'
                        : p.winsAboveExpected < 0
                          ? 'text-orange-600'
                          : ''
                    }`}
                  >
                    期待比 {formatSigned(p.winsAboveExpected)}勝
                  </span>
                </div>
              </button>
            );
          })}
        </div>
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
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  // 試合削除は作成者のみ（既存仕様）
  const canDelete = isCreator();
  // 勝率の表示は作成者または開発モードのときのみ（isCreator() は開発モードで true）
  const showWinRate = isCreator();
  const gasWebAppUrl = useSettingsStore((s) => s.gasWebAppUrl);
  const devMode = useDevMode();
  // 強さ指標（レート・偏差値・ランキング）は開発モードのときのみ
  const showPerformance = devMode;
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);

  // フィルタ対象プレイヤー名（null = フィルタ無し / 全試合表示）。
  // URL クエリ `?player=名前` に保持する。こうすることでスコア入力画面へ遷移して
  // 戻った際（`navigate('/history?player=…')` による再マウント）もフィルタが維持される。
  const [searchParams, setSearchParams] = useSearchParams();
  const filterPlayerName = searchParams.get('player');
  const setFilterPlayerName = useCallback(
    (name: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (name) next.set('player', name);
          else next.delete('player');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // 自分の試合フィルタは currentUser がある時のみ
  const canFilterByMe = !!session && !!currentUser;
  // 管理者以上の権限、または開発モードのときは自分以外のメンバーも選択できる。
  // （store の isAdmin() は開発モードでは true を返すため devMode の明示は不要）
  const canSelectOthers = !!session && isAdmin();
  const filterActive = !!session && !!filterPlayerName;

  // 選択できるメンバー（試合に参加したことのある人 + 自分）を名前で列挙。
  // 通常は自分を先頭に、残りを五十音（localeCompare）順で並べる。
  // 作成者または開発モード（showWinRate）のときは勝率の高い順に並べる。
  const filterablePlayerNames = useMemo(() => {
    const participantIds = new Set<string>();
    for (const match of matchHistory) {
      for (const id of [...match.teamA, ...match.teamB]) {
        if (id) participantIds.add(id);
      }
    }
    const names = new Set<string>();
    for (const p of players) {
      if (participantIds.has(p.id) && p.name) names.add(p.name);
    }
    if (currentUser) names.add(currentUser);
    const list = [...names];

    if (showWinRate) {
      // 勝率の高い順。未確定（試合数 0）の人は最後。同率は勝ち数→五十音で安定化。
      const recordOf = (name: string) =>
        computePlayerRecord(matchHistory, name, players);
      return list.sort((a, b) => {
        const ra = recordOf(a);
        const rb = recordOf(b);
        const wa = ra.winRate ?? -1;
        const wb = rb.winRate ?? -1;
        if (wb !== wa) return wb - wa;
        if (rb.wins !== ra.wins) return rb.wins - ra.wins;
        return a.localeCompare(b, 'ja');
      });
    }

    const sorted = list.sort((a, b) => a.localeCompare(b, 'ja'));
    if (currentUser && names.has(currentUser)) {
      return [currentUser, ...sorted.filter((n) => n !== currentUser)];
    }
    return sorted;
  }, [matchHistory, players, currentUser, showWinRate]);

  // 選択中のメンバーが候補から消えた場合（例: 管理者がそのメンバーの最後の
  // 試合を削除）はフィルタを解除する。controlled select の value が
  // option 集合とずれて「表示は全員なのに実際は空フィルタ」になるのを防ぐ。
  // filterablePlayerNames は currentUser を常に含むため自分選択時は解除されない。
  useEffect(() => {
    if (filterPlayerName && !filterablePlayerNames.includes(filterPlayerName)) {
      setFilterPlayerName(null);
    }
  }, [filterPlayerName, filterablePlayerNames, setFilterPlayerName]);

  // フィルタ対象プレイヤーの通算成績（勝敗・勝率）。フィルタ中のみ算出。
  const playerRecord = useMemo(() => {
    if (!filterPlayerName) return null;
    return computePlayerRecord(matchHistory, filterPlayerName, players);
  }, [matchHistory, filterPlayerName, players]);

  // 本日のパフォーマンス指標（レート・偏差値）。全試合を連立で解くため
  // メンバー単位ではなくセッション全体で 1 回だけ計算する。
  const performanceResult = useMemo(() => {
    if (!showPerformance) return null;
    return computePerformanceRatings(matchHistory, players);
  }, [showPerformance, matchHistory, players]);
  const playerPerformance = performanceResult
    ? findPerformance(performanceResult, filterPlayerName)
    : null;

  // 全試合に通し番号を振った後でフィルタを適用（番号は全体基準で安定）
  const { unscoredMatches, scoredMatches } = useMemo(() => {
    const totalCount = matchHistory.length;
    const reversed = [...matchHistory].reverse();
    const unscored: { match: Match; matchNumber: number }[] = [];
    const scored: { match: Match; matchNumber: number }[] = [];
    reversed.forEach((match, reverseIndex) => {
      if (filterActive && !isMatchOfPlayer(match, filterPlayerName, players)) return;
      const matchNumber = totalCount - reverseIndex;
      const isNoScore = match.scoreA === 0 && match.scoreB === 0 && !match.winner;
      if (isNoScore) {
        unscored.push({ match, matchNumber });
      } else {
        scored.push({ match, matchNumber });
      }
    });
    return { unscoredMatches: unscored, scoredMatches: scored };
  }, [matchHistory, filterActive, filterPlayerName, players]);

  // フィルタ適用後の未入力有無で折り畳みを判定（自分視点に合わせる）
  const hasUnscored = unscoredMatches.length > 0;
  const [scoredCollapsed, setScoredCollapsed] = useState(() => hasUnscored);

  useEffect(() => {
    setScoredCollapsed(hasUnscored);
  }, [hasUnscored]);

  // 未入力アコーディオン: 通常は未入力があれば開いたまま、開発モードでは閉じたままがデフォルト
  const [unscoredCollapsed, setUnscoredCollapsed] = useState(() => devMode);

  useEffect(() => {
    setUnscoredCollapsed(devMode);
  }, [hasUnscored, devMode]);

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const getPlayerRating = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.rating ?? 0;
  };

  const handleEdit = (matchId: string) => {
    // フィルタ中はクエリを付けて戻り先に引き継ぐ（スコア入力後もフィルタを維持）
    const from = filterPlayerName
      ? `/history?player=${encodeURIComponent(filterPlayerName)}`
      : '/history';
    navigate(`/score/${matchId}`, { state: { from } });
  };

  const handleDelete = async (matchId: string) => {
    await writer.removeMatch(matchId);
  };

  const handleShortMatchWarning = () => {
    toast.warning(SHORT_MATCH_WARNING_MESSAGE, 1000);
  };

  // CSV1 fix: RFC 4180 のエスケープ。`,`/`"`/`\n`/`\r` を含むフィールドは
  // ダブルクォートで囲み、内部の `"` は `""` に置き換える。
  const csvEscape = (value: string | number): string => {
    const s = String(value);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleCopyHistory = async () => {
    const dateStr = formatLocalDate(session?.config.practiceStartTime ?? Date.now());
    const gymName = session?.config.gym || '';

    const headers = ['日付', '場所', 'A選手1', 'A選手2', 'B選手1', 'B選手2', 'スコアA', 'スコアB', '試合時間'];
    const lines: string[] = [headers.map(csvEscape).join(',')];

    matchHistory.forEach((match) => {
      const isMatchSingles = match.teamA[1] === '' && match.teamB[1] === '';
      const a1 = getPlayerName(match.teamA[0]);
      const a2 = isMatchSingles ? '' : getPlayerName(match.teamA[1]);
      const b1 = getPlayerName(match.teamB[0]);
      const b2 = isMatchSingles ? '' : getPlayerName(match.teamB[1]);
      const duration = Math.round((match.finishedAt - match.startedAt) / 60000);
      const row = [dateStr, gymName, a1, a2, b1, b2, match.scoreA, match.scoreB, duration];
      lines.push(row.map(csvEscape).join(','));
    });

    const text = lines.join('\n') + '\n';
    const success = await copyToClipboard(text);
    if (!success) {
      toast.error('コピーに失敗しました');
    }
  };

  // 楽観的表示: GAS Webアプリは応答まで数十秒かかることがあるため、完了を
  // 待たずに「送信しました」を出し、裏で失敗を検知したときだけエラーを出す。
  // GAS 側は matchId で重複排除するので、失敗時の再送信は安全。
  const handleUpload = () => {
    if (!session || !gasWebAppUrl) return;
    const uploadSession = session;
    const matches = matchHistory;
    toast.success(`${matches.length}件の試合を送信しました`);
    void (async () => {
      const result = await sendMatchesToSheets(
        gasWebAppUrl,
        matches,
        players,
        uploadSession
      );
      if (!result.success) {
        // 「送信しました」の後に出る想定外の通知なので長めに表示する
        toast.error(result.message, 6000);
        return;
      }
      // アップロード記録は実際の成功後にのみ Firestore に書く
      // （セッション一覧の未実施バッジ用）。記録の失敗は warn に留める。
      try {
        await updateSession(uploadSession.id, {
          matchUpload: {
            uploadedAt: Date.now(),
            matchCount: matches.length,
            ...(currentUser ? { uploadedBy: currentUser } : {}),
          },
        });
      } catch (err) {
        console.warn('[History] Failed to record match upload status:', err);
        // 一般ユーザーには送信成否と切り離して見せる（設計方針）が、バッジは
        // 開発モード限定表示のため、その利用者には原因が見えないと診断できない。
        // devMode のときだけ記録失敗を可視化する。
        if (devMode) {
          const detail = err instanceof Error ? err.message : String(err);
          toast.warning(`アップロード記録の保存に失敗（一覧のバッジは更新されません）: ${detail}`, 8000);
        }
      }
    })();
  };

  return (
    <div className="pb-[calc(60px+env(safe-area-inset-bottom)+1rem)]">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <History size={20} />
            <h1 className="text-lg font-bold">試合履歴</h1>
          </div>
          {gasWebAppUrl && (
            <button
              onClick={handleUpload}
              disabled={matchHistory.length === 0}
              aria-label="Sheetsにアップロード"
              className="disabled:opacity-50"
            >
              <Upload size={20} />
            </button>
          )}
          <button
            onClick={handleCopyHistory}
            aria-label="コピー"
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
              {canSelectOthers ? (
                // 管理者以上 / 開発モード: 任意のメンバーで絞り込める
                <label className="w-full flex items-center gap-2 px-3 rounded-xl text-sm font-medium bg-secondary text-secondary-foreground min-h-[44px]">
                  <User size={16} className="flex-shrink-0" />
                  <span className="flex-shrink-0">メンバー</span>
                  <select
                    value={filterPlayerName ?? ''}
                    onChange={(e) => setFilterPlayerName(e.target.value || null)}
                    aria-label="メンバーで絞り込み"
                    className="flex-1 min-w-0 bg-transparent text-base font-medium text-right py-2 focus:outline-none appearance-none"
                    style={{ WebkitAppearance: 'none' }}
                  >
                    <option value="">全員</option>
                    {filterablePlayerNames.map((name) => (
                      <option key={name} value={name}>
                        {name === currentUser ? `${name}（自分）` : name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                canFilterByMe && (
                  <button
                    onClick={() =>
                      setFilterPlayerName(filterPlayerName ? null : currentUser)
                    }
                    aria-pressed={filterActive}
                    aria-label="自分の試合のみ表示"
                    className={`w-full flex items-center justify-center gap-2 px-3 rounded-xl text-sm font-medium transition-colors min-h-[44px] active:scale-[0.98] ${
                      filterActive
                        ? ''
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                    style={
                      filterActive
                        ? { backgroundColor: '#e0e7ff', color: '#3730a3' }
                        : undefined
                    }
                  >
                    <User size={16} />
                    <span>{filterActive ? '自分の試合のみ ✓' : '自分の試合のみ'}</span>
                  </button>
                )
              )}

              {/* 成績サマリはフィルタの下・試合一覧の上に表示する */}
              {filterActive && playerRecord && (
                <PlayerRecordSummary
                  playerName={filterPlayerName}
                  isSelf={filterPlayerName === currentUser}
                  record={playerRecord}
                  showWinRate={showWinRate}
                  performance={playerPerformance}
                />
              )}

              {/* 強さランキング（開発モード限定） */}
              {performanceResult && performanceResult.players.length > 0 && (
                <PerformanceRanking
                  players={performanceResult.players}
                  ratedMatchCount={performanceResult.ratedMatchCount}
                  currentUser={currentUser}
                  selectedName={filterPlayerName}
                  onSelect={(name) =>
                    setFilterPlayerName(name === filterPlayerName ? null : name)
                  }
                />
              )}

              {filterActive && unscoredMatches.length === 0 && scoredMatches.length === 0 ? (
                <EmptyState
                  icon="🔍"
                  title={
                    filterPlayerName === currentUser
                      ? 'あなたの試合はまだありません'
                      : `「${filterPlayerName}」さんの試合はまだありません`
                  }
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
                  canDelete={canDelete}
                  unscoredCollapsed={unscoredCollapsed}
                  setUnscoredCollapsed={setUnscoredCollapsed}
                  scoredCollapsed={scoredCollapsed}
                  setScoredCollapsed={setScoredCollapsed}
                  onShortMatchWarning={handleShortMatchWarning}
                  highlightName={filterActive ? filterPlayerName : null}
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
