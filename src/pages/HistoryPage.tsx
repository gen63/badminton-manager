import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useReservationStore } from '../stores/reservationStore';
import { usePairPreferenceStore } from '../stores/pairPreferenceStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useNextMatchPrediction } from '../hooks/useNextMatchPrediction';
import { formatTime, copyToClipboard } from '../lib/utils';
import { nameCharCount, pickNameFontSizePx, NAME_NO_TRUNCATE_MAX_CHARS } from '../lib/matchNameFont';
import { formatLocalDate } from '../lib/sessionArchive';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { updateSession } from '../services/sessionService';
import { isMatchOfPlayer, computePlayerRecord } from '../lib/matchFilter';
import type { PlayerRecord } from '../lib/matchFilter';
import {
  computePerformanceRatings,
  findPerformance,
  reassignDisplayRanks,
  getPlayerMatchInsight,
  judgeMatchNeutral,
  NEUTRAL_VERDICT_LABELS,
  NEUTRAL_VERDICT_CHIP_CLASSES,
  countVerdicts,
  VERDICT_LABELS,
  VERDICT_CHIP_CLASSES,
} from '../lib/performanceRating';
import type { PlayerPerformance, PlayerMatchInsight, MatchInsight, MatchVerdict } from '../lib/performanceRating';
import { useDevMode } from '../hooks/useDevMode';
import { Copy, Trash2, Edit3, Clock, Upload, History, ChevronDown, ChevronUp, User, AlertTriangle, BarChart3, RotateCcw } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { BottomNav } from '../components/BottomNav';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { OrphanPlayerAssignModal, type AssignScope } from '../components/OrphanPlayerAssignModal';
import { countOrphanMatches } from '../services/sessionMutations';
import { FINISH_REVERT_WINDOW_MS, gameModeFromPracticeType } from '../lib/gameOperations';
import { canFinishGame, selectOperatorIds, finishAllowedIds } from '../lib/finishOperationGuide';
import type { RevertFinishError } from '../lib/gameOperations';

import type { Match } from '../types/match';

/** 履歴画面「コートに戻す」の失敗理由（コード）→ トースト文言 */
const REVERT_ERROR_MESSAGES: Record<RevertFinishError, string> = {
  not_found: '試合が見つかりませんでした',
  expired: '終了から2分を過ぎたため戻せません',
  no_revert_info: 'この試合は戻せません（対応前の記録です）',
  court_busy: '次の試合が進んでいるため戻せません',
  player_elsewhere: 'メンバーが別のコートにいるため戻せません',
  not_latest: 'このコートで新しい試合が始まっているため戻せません',
};

const SHORT_MATCH_WARNING_MESSAGE = '試合時間が短すぎます（操作ミスの可能性）';

/**
 * チームの名前を1人ずつ描画し、絞り込み中のメンバーだけを強調する。
 * 名前ごとに独立した折り返し単位（flex アイテム）にしているため、
 * 幅が足りないときはまず名前の区切りで改行され、1人の名前だけで
 * 1行に収まらない場合にのみ名前の途中で折り返す。
 */
function TeamNames({
  playerIds,
  getPlayerName,
  highlightName,
  isOrphanId,
  onTapOrphan,
}: {
  playerIds: string[];
  getPlayerName: (id: string) => string;
  highlightName: string | null;
  /** 名簿から消えたメンバーの ID（空スロットの '' は含まない） */
  isOrphanId: (id: string) => boolean;
  /** 修復権限があるときのみ渡される。未設定をタップして割り当て直す */
  onTapOrphan?: (orphanId: string) => void;
}) {
  return (
    <>
      {playerIds.map((id, i) => {
        const isHighlighted = getPlayerName(id) === highlightName;
        // 3文字以下は省略しない。4文字以上は省略しても最低「3文字＋…」（4em）を残す
        const short = nameCharCount(getPlayerName(id)) <= NAME_NO_TRUNCATE_MAX_CHARS;
        const fitClass = short ? 'flex-shrink-0' : 'min-w-0 truncate';
        const fitStyle = short ? undefined : { minWidth: '4em' };
        // 消えたメンバーの「未設定」だけタップで修復できる。空スロット（3人試合）は対象外
        if (onTapOrphan && isOrphanId(id)) {
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              onClick={() => onTapOrphan(id)}
              className={`${fitClass} whitespace-nowrap underline decoration-dotted underline-offset-2 text-amber-700 hover:text-amber-800 active:scale-95 transition-all duration-150`}
              style={fitStyle}
              title="誰だったか割り当てて修復する"
            >
              {getPlayerName(id)}
            </button>
          );
        }
        return (
          <span
            key={`${id}-${i}`}
            className={`${fitClass} whitespace-nowrap ${isHighlighted ? 'font-bold text-indigo-600' : ''}`}
            style={fitStyle}
          >
            {getPlayerName(id)}
          </span>
        );
      })}
    </>
  );
}

/**
 * 「コートに戻す」ボタン。終了2分以内だけ表示する。
 *
 * 期限までの残り時間を自分だけで管理する（1秒ごとの `setInterval` はこの
 * コンポーネントに閉じており、期限切れの試合が並ぶ一覧全体は再描画されない）。
 * 期限が来たら自身を非表示にする（`null` を返す）。
 */
function RevertToCourtButton({
  finishedAt,
  onClick,
}: {
  finishedAt: number;
  onClick: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(
    () => FINISH_REVERT_WINDOW_MS - (Date.now() - finishedAt),
  );

  const expired = remainingMs <= 0;
  useEffect(() => {
    // 期限切れのカードではタイマーを張らない（履歴が増えても毎秒の再描画が積もらない）
    if (expired) return;
    const id = setInterval(() => {
      setRemainingMs(FINISH_REVERT_WINDOW_MS - (Date.now() - finishedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [finishedAt, expired]);

  if (expired) return null;

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, '0');

  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 w-full flex items-center justify-center gap-1 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 active:scale-[0.98] rounded-lg py-1.5 transition-all duration-150"
    >
      <RotateCcw size={12} />
      コートに戻す（残り {mm}:{ss}）
    </button>
  );
}

/** 分析列の表示用データ。本人視点（絞り込み時）と中立（勝者視点・全員表示時）の両方を表す。 */
interface MatchInsightView {
  teamADeviation: number;
  teamBDeviation: number;
  /** 強調する側（本人側）。中立表示では null（どちらも強調しない） */
  highlight: 'A' | 'B' | null;
  label: string;
  chipClass: string;
  textClass: string;
  /** 3行目に出す予想勝率（0〜1）。本人視点は本人側、中立は勝者側 */
  probability: number;
}

function toPlayerInsightView(i: PlayerMatchInsight): MatchInsightView {
  const cls = VERDICT_CHIP_CLASSES[i.verdict];
  return {
    teamADeviation: i.teamADeviation,
    teamBDeviation: i.teamBDeviation,
    highlight: i.ownIsA ? 'A' : 'B',
    label: VERDICT_LABELS[i.verdict],
    chipClass: cls.chip,
    textClass: cls.text,
    probability: i.ownWinProbability,
  };
}

function toNeutralInsightView(match: Match, insight: MatchInsight | undefined): MatchInsightView | null {
  if (!insight || (match.winner !== 'A' && match.winner !== 'B')) return null;
  const winnerProb = match.winner === 'A' ? insight.winProbabilityA : 1 - insight.winProbabilityA;
  const verdict = judgeMatchNeutral(winnerProb);
  const cls = NEUTRAL_VERDICT_CHIP_CLASSES[verdict];
  return {
    teamADeviation: insight.teamADeviation,
    teamBDeviation: insight.teamBDeviation,
    highlight: null,
    label: NEUTRAL_VERDICT_LABELS[verdict],
    chipClass: cls.chip,
    textClass: cls.text,
    probability: winnerProb,
  };
}

/** 分析列 2 行目: 両チームの平均偏差を「63 vs 53」の形で1行表示。 */
function InsightVs({
  leftValue,
  leftOwn,
  rightValue,
  rightOwn,
}: {
  leftValue: number;
  leftOwn: boolean;
  rightValue: number;
  rightOwn: boolean;
}) {
  return (
    <span className="flex items-baseline justify-end gap-0.5 whitespace-nowrap leading-tight">
      <span
        className={`text-[13px] ${
          leftOwn ? 'text-indigo-600 font-bold' : 'text-muted-foreground'
        }`}
      >
        {leftValue}
      </span>
      <span className="text-[10px] text-muted-foreground">vs</span>
      <span
        className={`text-[13px] ${
          rightOwn ? 'text-indigo-600 font-bold' : 'text-muted-foreground'
        }`}
      >
        {rightValue}
      </span>
    </span>
  );
}

/** 分析列 1 行目: 判定チップのみ。 */
function InsightVerdictChip({ insight }: { insight: MatchInsightView }) {
  return (
    <span
      className={`justify-self-end rounded-full text-[10px] px-1.5 font-bold whitespace-nowrap ${insight.chipClass}`}
    >
      {insight.label}
    </span>
  );
}

/** 分析列 3 行目: 本人側の予想勝率。 */
function InsightWinProbability({ insight }: { insight: MatchInsightView }) {
  return (
    <span className={`text-xs font-bold ${insight.textClass} whitespace-nowrap justify-self-end`}>
      {Math.round(insight.probability * 100)}%
    </span>
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
  isOrphanId,
  onAssignOrphan,
  canRevert,
  onRevertClick,
  insight,
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
  isOrphanId: (id: string) => boolean;
  onAssignOrphan?: (orphanId: string, match: Match, matchNumber: number) => void;
  /** 終了操作と同じ権限（`canFinishGame`）。無ければ「コートに戻す」は出さない */
  canRevert: boolean;
  onRevertClick: (match: Match) => void;
  /** 開発モードのみ（絞り込み時は本人視点、全員表示時は勝者視点）。試合ごとの分析（平均偏差・予想勝率・判定） */
  insight?: MatchInsightView | null;
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

  // 旧データ（finishRevert 無し）はそもそも出さない。既に2分を過ぎている場合は
  // `RevertToCourtButton` が自身の初期状態（`Date.now()` は useState の遅延初期化
  // 内で評価するのでレンダー本体では呼ばない）で判定して null を返す。
  const showRevert = canRevert && !!match.finishRevert;

  // 表示は勝者が上段。分析の A/B を上段(left)/下段(right)へ振り直す。
  // 勝敗確定済みの試合にしか分析は付かないので isTeamAWinner で決まる。
  const leftDeviation = insight ? (isTeamAWinner ? insight.teamADeviation : insight.teamBDeviation) : 0;
  const rightDeviation = insight ? (isTeamAWinner ? insight.teamBDeviation : insight.teamADeviation) : 0;
  const ownIsLeft = insight?.highlight != null && (insight.highlight === 'A') === isTeamAWinner;
  const ownIsRight = insight?.highlight != null && !ownIsLeft;

  // 名前が入りきらないときは行ごとにフォントを縮小（1行目 / 2行目は VS ピルぶんも考慮）
  const namesChars = (ids: string[]) => ids.reduce((n, id) => n + nameCharCount(getPlayerName(id)), 0);
  const leftFontPx = pickNameFontSizePx(namesChars(leftIds), { hasVsPill: false, hasInsight: !!insight, nameCount: leftIds.length });
  const rightFontPx = pickNameFontSizePx(namesChars(rightIds), { hasVsPill: true, hasInsight: !!insight, nameCount: rightIds.length });

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

        {/*
          分析あり: 中央3行と分析列を 2 列 × 3 行のグリッドに載せ、行ごとに
          items-center で揃える（名前が折り返して行が高くなっても分析は同じ行の中央）。
          分析なし: 従来どおりの縦積み。
          チームは上下2段（日本語の名前2人分が横並びでは入らないため）。
          勝者が上段（太字）、敗者が下段（VS バッジ付き・淡色）。
        */}
        <div
          className={
            insight
              ? 'flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5'
              : 'flex-1 min-w-0 space-y-0.5'
          }
        >
          <div className="flex flex-nowrap items-baseline gap-x-1.5 gap-y-0.5 leading-tight font-bold text-foreground whitespace-nowrap min-w-0 overflow-hidden" style={{ fontSize: leftFontPx }}>
            <TeamNames
              playerIds={leftIds}
              getPlayerName={getPlayerName}
              highlightName={highlightName}
              isOrphanId={isOrphanId}
              onTapOrphan={onAssignOrphan && ((id) => onAssignOrphan(id, match, matchNumber))}
            />
          </div>
          {insight && <InsightVerdictChip insight={insight} />}
          <div className="flex flex-nowrap items-baseline gap-x-1.5 gap-y-0.5 leading-tight text-muted-foreground whitespace-nowrap min-w-0 overflow-hidden" style={{ fontSize: rightFontPx }}>
            <span className="font-bold text-[10px] px-1.5 bg-card rounded-full py-0.5 flex-shrink-0">VS</span>
            <TeamNames
              playerIds={rightIds}
              getPlayerName={getPlayerName}
              highlightName={highlightName}
              isOrphanId={isOrphanId}
              onTapOrphan={onAssignOrphan && ((id) => onAssignOrphan(id, match, matchNumber))}
            />
          </div>
          {insight && (
            <InsightVs
              leftValue={leftDeviation}
              leftOwn={ownIsLeft}
              rightValue={rightDeviation}
              rightOwn={ownIsRight}
            />
          )}
          <div className="flex flex-nowrap items-center gap-1.5 text-[11px] text-muted-foreground leading-tight whitespace-nowrap">
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
          {insight && <InsightWinProbability insight={insight} />}
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
      {showRevert && (
        <RevertToCourtButton finishedAt={match.finishedAt} onClick={() => onRevertClick(match)} />
      )}
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
  isOrphanId,
  onAssignOrphan,
  canRevert,
  onRevertClick,
  getInsight,
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
  isOrphanId: (id: string) => boolean;
  onAssignOrphan?: (orphanId: string, match: Match, matchNumber: number) => void;
  canRevert: boolean;
  onRevertClick: (match: Match) => void;
  getInsight?: (match: Match) => MatchInsightView | null;
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
            <span>結果未入力（{unscoredMatches.length}件）</span>
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
              isOrphanId={isOrphanId}
              onAssignOrphan={onAssignOrphan}
              canRevert={canRevert}
              onRevertClick={onRevertClick}
              insight={getInsight?.(match)}
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
            <span>結果入力済み（{scoredMatches.length}件）</span>
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
              isOrphanId={isOrphanId}
              onAssignOrphan={onAssignOrphan}
              canRevert={canRevert}
              onRevertClick={onRevertClick}
              insight={getInsight?.(match)}
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
  verdictCounts,
}: {
  playerName: string | null;
  isSelf: boolean;
  record: PlayerRecord;
  // 勝率は作成者または開発モードのときのみ表示する
  showWinRate: boolean;
  // 強さ指標（レート・偏差値など）は開発モードのときのみ。対象外なら null
  performance: PlayerPerformance | null;
  // 判定ごとの内訳（開発モードのみ。0件の種類は含まない）
  verdictCounts: { verdict: MatchVerdict; count: number }[];
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
              偏差値{' '}
              <span className="text-base font-bold">
                {performance.deviation}
              </span>
              {performance.genderDeviation !== null && (
                <span className="text-xs opacity-90">
                  （{performance.gender === 'F' ? '女' : '男'} {performance.genderDeviation}）
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs opacity-90">
            <span>相手平均 偏差{performance.opponentDeviation}</span>
            {performance.partnerDeviation !== null && (
              <span>味方平均 偏差{performance.partnerDeviation}</span>
            )}
            <span>
              期待勝率 {performance.expectedWinRate ?? '—'}% →{' '}
              {performance.winRate ?? '—'}%（
              {formatSigned(performance.winsAboveExpected)}勝 ±
              {performance.winsAboveExpectedError.toFixed(1)}）
            </span>
          </div>
          {verdictCounts.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {verdictCounts.map(({ verdict, count }) => (
                <span
                  key={verdict}
                  className={`rounded-full text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap ${VERDICT_CHIP_CLASSES[verdict].chip}`}
                >
                  {VERDICT_LABELS[verdict]} {count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 本日の結果集計（開発モード限定）。
 * 対戦相手・味方の強さを加味した偏差値順に並べる。単純な勝率順ではないため、
 * 弱い相手にだけ勝った人は上位に来ない。
 *
 * **偏差値は整数**で、同じ値なら同順位（1, 2, 2, 4 形式）。日次の推定は誤差が
 * ±5.5 ポイントあり、小数まで出すと精度を偽ることになるため。同値の並び順は
 * 登録レートが高い方を上にする。
 */
function PerformanceRanking({
  players,
  ratedMatchCount,
  currentUser,
  selectedName,
  onSelect,
  collapsed,
  onToggle,
}: {
  players: PlayerPerformance[];
  ratedMatchCount: number;
  currentUser: string | null;
  selectedName: string | null;
  onSelect: (name: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors"
        style={{ backgroundColor: '#e0e7ff', color: '#3730a3' }}
      >
        <span className="flex items-center gap-2">
          <BarChart3 size={16} />
          結果集計（{ratedMatchCount}試合から算出）
        </span>
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>

      {!collapsed && (
        <div className="space-y-1">
          {players.map((p) => {
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                        {p.displayRank}
                      </span>
                      <span className="truncate text-sm font-bold text-foreground">
                        {p.name}
                        {p.name === currentUser && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            （自分）
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground whitespace-nowrap">
                        {p.total}試合
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground whitespace-nowrap">
                        {p.wins}勝{p.losses}敗（{p.winRate}%）
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pl-7 text-[11px] text-muted-foreground">
                      <span className="whitespace-nowrap">
                        相手平均 偏差{p.opponentDeviation}
                      </span>
                      <span
                        className={`whitespace-nowrap ${
                          p.isSignificant
                            ? p.winsAboveExpected > 0
                              ? 'font-medium text-emerald-600'
                              : 'font-medium text-orange-600'
                            : ''
                        }`}
                        title={
                          p.isSignificant ? '偶然では説明しにくい差' : undefined
                        }
                      >
                        期待比 {formatSigned(p.winsAboveExpected)}勝
                        <span className="opacity-60">
                          {' '}
                          ±{p.winsAboveExpectedError.toFixed(1)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                    <span className="text-sm font-bold text-foreground">
                      偏差 {p.deviation}
                    </span>
                    {p.genderDeviation !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        {p.gender === 'F' ? '女' : '男'} {p.genderDeviation}
                      </span>
                    )}
                  </div>
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
  // 「未設定」の修復も作成者または開発モードのみ。誰でも履歴を書き換えられると困る
  const canRepairOrphan = isCreator();
  const gasWebAppUrl = useSettingsStore((s) => s.gasWebAppUrl);
  const devMode = useDevMode();
  // 強さ指標（レート・偏差値・結果集計）は開発モードのときのみ
  const showPerformance = devMode;
  const toast = useToast();
  const writer = useSessionWriterWithToast(toast);
  // 「未設定」タップで開く修復モーダルの対象（null = 閉じている）
  const [orphanTarget, setOrphanTarget] = useState<{
    orphanId: string;
    match: Match;
    matchNumber: number;
  } | null>(null);

  // ===== 「コートに戻す」権限判定 =====
  // 終了ボタンと同じ権限（`canFinishGame`）。予測には試合終了ボタンと同じ
  // 入力（配置予測の「ほぼ確定」＝操作担当）が要る。
  const courts = useGameStore((s) => s.courts);
  const reservations = useReservationStore((s) => s.reservations);
  const pairPreferences = usePairPreferenceStore((s) => s.pairPreferences);
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const practiceType = useSettingsStore((s) => s.practiceType);
  const lateBalanceMode = useSettingsStore((s) => s.lateBalanceMode);
  const genderBalanceMode = useSettingsStore((s) => s.genderBalanceMode);
  const reservationBlockThreshold = useSettingsStore((s) => s.reservationBlockThreshold);
  const gameMode = gameModeFromPracticeType(practiceType);

  const { prediction: nextMatchPrediction } = useNextMatchPrediction({
    session,
    players,
    courts,
    matchHistory,
    reservations,
    useStayDurationPriority,
    gameMode,
    lateBalanceMode,
    genderBalanceMode,
    reservationBlockThreshold,
    pairPreferences,
  });
  const myPlayerId = useMemo(
    () => players.find((p) => p.name === currentUser)?.id ?? null,
    [players, currentUser],
  );
  const canRevertFinish = canFinishGame({
    isAdmin: isAdmin(),
    // 終了ボタンと同じく、操作担当または「ほぼ確定」で判定する
    certainIds: finishAllowedIds(
      selectOperatorIds(nextMatchPrediction, players),
      nextMatchPrediction.certainIds,
    ),
    myPlayerId,
  });

  // 「コートに戻す」確認ダイアログの対象（null = 非表示）
  const [revertTarget, setRevertTarget] = useState<Match | null>(null);

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
  // 試合ごとの分析（開発モード + メンバー絞り込み中のみ）
  const matchInsights = performanceResult?.matchInsights;
  const getInsight = useMemo(() => {
    if (!matchInsights) return undefined;
    if (!filterActive) return (m: Match) => toNeutralInsightView(m, matchInsights.get(m.id));
    return (m: Match) => {
      const v = getPlayerMatchInsight(m, filterPlayerName, players, matchInsights);
      return v ? toPlayerInsightView(v) : null;
    };
  }, [matchInsights, filterActive, filterPlayerName, players]);
  const verdictCounts = useMemo(
    () =>
      matchInsights && filterActive
        ? countVerdicts(matchHistory, filterPlayerName, players, matchInsights)
        : [],
    [matchInsights, filterActive, matchHistory, filterPlayerName, players]
  );
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
  const [scoredCollapsed, setScoredCollapsed] = useState(() => devMode || hasUnscored);
  const [unscoredCollapsed, setUnscoredCollapsed] = useState(() => devMode);
  // フィルタ切り替えなどで hasUnscored が変わった直近の値を覚えておき、
  // レンダー中に折り畳み状態を再判定する（Effect を使わない同期パターン）
  const [prevHasUnscored, setPrevHasUnscored] = useState(hasUnscored);
  // 結果集計での選択直後は、自動判定より「入力済みを開く」を優先する
  const [skipScoredAutoCollapse, setSkipScoredAutoCollapse] = useState(false);

  if (skipScoredAutoCollapse) {
    setSkipScoredAutoCollapse(false);
  } else if (hasUnscored !== prevHasUnscored) {
    setScoredCollapsed(devMode || hasUnscored);
  }
  if (hasUnscored !== prevHasUnscored) {
    setPrevHasUnscored(hasUnscored);
    setUnscoredCollapsed(devMode);
  }

  // 結果集計を開いたときは、未入力・入力済みの試合一覧を畳んで見やすくする
  const [rankingCollapsed, setRankingCollapsed] = useState(() => !showPerformance);

  // 結果集計を開く（未入力・入力済みの試合一覧を畳む）。フィルター選択でも使用。
  const openRanking = () => {
    setRankingCollapsed(false);
    setUnscoredCollapsed(true);
    setScoredCollapsed(true);
  };

  const handleToggleRanking = () => {
    setRankingCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        setUnscoredCollapsed(true);
        setScoredCollapsed(true);
      }
      return next;
    });
  };

  // 結果集計の性別フィルター（全員 / 男 / 女）。開発モード限定。永続化しない。
  const [genderFilter, setGenderFilter] = useState<'all' | 'M' | 'F'>('all');

  // 性別フィルターを適用した結果集計プレイヤー
  // genderFilter !== 'all' の場合は、フィルタ後の集団内で順位を振り直す
  const filteredPerformancePlayers = useMemo(() => {
    if (!performanceResult) return [];
    if (genderFilter === 'all') {
      return performanceResult.players;
    }
    const filtered = performanceResult.players.filter((p) => p.gender === genderFilter);
    return reassignDisplayRanks(filtered);
  }, [performanceResult, genderFilter]);

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const getPlayerRating = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.rating ?? 0;
  };

  /**
   * 名簿から消えたメンバーの ID（履歴で「未設定」と出る）。
   * 空文字は3人試合の空きスロットで、同じ「未設定」表示でも別物なので除く。
   */
  const isOrphanId = (playerId: string) =>
    playerId !== '' && !players.some((p) => p.id === playerId);

  const handleAssignOrphan = async (playerId: string, scope: AssignScope) => {
    if (!orphanTarget) return;
    const { orphanId, match } = orphanTarget;
    const name = players.find((p) => p.id === playerId)?.name ?? '';
    setOrphanTarget(null);
    await writer.assignOrphanPlayer(orphanId, playerId, scope === 'match' ? match.id : undefined);
    toast.success(
      scope === 'match' ? `この試合を${name}に修復しました` : `${name}の試合を修復しました`,
    );
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

  // 「コートに戻す」タップ: 確認ダイアログを開く
  const handleRevertClick = (match: Match) => {
    setRevertTarget(match);
  };

  // 確認ダイアログの本文（コート・両チーム名。次の組がいれば取り消す旨、
  // 結果入力済みなら消える旨を添える）。押した瞬間の状態で固定する
  // （`revertTarget` が state で確定しているため、都度呼んでも表示内容はぶれない）。
  const buildRevertConfirmMessage = (match: Match): string => {
    const court = courts.find((c) => c.id === match.courtId);
    const courtLabel = courts.length > 1 ? `${match.courtId}コート` : 'この試合';
    const teamANames = match.teamA.filter((id) => id).map(getPlayerName);
    const teamBNames = match.teamB.filter((id) => id).map(getPlayerName);
    const lines = [`${courtLabel}: ${teamANames.join('・')} vs ${teamBNames.join('・')}`];

    const hasResult = match.winner !== undefined || match.scoreA !== 0 || match.scoreB !== 0;
    if (hasResult) {
      lines.push('入力した結果は消えます。');
    }

    // コートが連続配置で自動開始した次の組のままなら、戻すときにその試合を取り消す
    const nextGroupOnCourt =
      !!court?.isPlaying &&
      match.finishRevert?.nextStartedAt !== undefined &&
      court.startedAt === match.finishRevert.nextStartedAt;
    if (nextGroupOnCourt && court) {
      const nextANames = court.teamA.filter((id) => id).map(getPlayerName);
      const nextBNames = court.teamB.filter((id) => id).map(getPlayerName);
      lines.push(`${nextANames.join('・')} vs ${nextBNames.join('・')} の試合は取り消されます。`);
    }

    return lines.join('\n');
  };

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    const match = revertTarget;
    setRevertTarget(null);
    const res = await writer.revertMatchFinish(match.id);
    // undefined = SessionError（conflict 等）。useSessionWriterWithToast が
    // 既定文言のトーストを既に出しているのでここでは何もしない。
    if (!res) return;
    if (res.result === 'success') {
      const label = courts.length > 1 ? `${match.courtId}コート` : 'コート';
      toast.success(`${label}に戻しました`);
      return;
    }
    toast.error(REVERT_ERROR_MESSAGES[res.result]);
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
                  verdictCounts={verdictCounts}
                />
              )}

              {/* 結果集計（開発モード限定） */}
              {performanceResult && performanceResult.players.length > 0 && (
                <>
                  {/* 結果集計の性別フィルター（全員 / 男 / 女） */}
                  <div
                    role="group"
                    aria-label="結果集計の性別フィルター"
                    className="flex gap-1.5"
                  >
                    {(['all', 'M', 'F'] as const).map((gender) => {
                      const label = gender === 'all' ? '全員' : gender === 'M' ? '男' : '女';
                      const isSelected = genderFilter === gender;
                      return (
                        <button
                          key={gender}
                          type="button"
                          onClick={() => {
                            setGenderFilter(gender);
                            // 性別を選び直したら、画面上部のメンバー絞り込みは「全員」に戻す
                            setFilterPlayerName(null);
                            // 結果集計が閉じているときだけ開く
                            if (rankingCollapsed) {
                              openRanking();
                            }
                          }}
                          aria-pressed={isSelected}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.98] ${
                            isSelected
                              ? 'bg-indigo-100 text-indigo-700 font-bold'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 結果集計の本体 */}
                  {filteredPerformancePlayers.length > 0 ? (
                    <PerformanceRanking
                      players={filteredPerformancePlayers}
                      ratedMatchCount={performanceResult.ratedMatchCount}
                      currentUser={currentUser}
                      selectedName={filterPlayerName}
                      onSelect={(name) => {
                        setFilterPlayerName(name === filterPlayerName ? null : name);
                        // 絞り込み結果（試合一覧）を見せるため、選択・解除とも最上部へ戻す
                        // （この画面のスクロール要素は window）
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        setRankingCollapsed(true);
                        setSkipScoredAutoCollapse(true);
                        setScoredCollapsed(false);
                      }}
                      collapsed={rankingCollapsed}
                      onToggle={handleToggleRanking}
                    />
                  ) : (
                    <div className="rounded-lg px-4 py-8 text-center text-muted-foreground space-y-1">
                      <div className="text-sm font-medium">該当するメンバーがいません</div>
                    </div>
                  )}
                </>
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
                  isOrphanId={isOrphanId}
                  onAssignOrphan={
                    canRepairOrphan
                      ? (orphanId, match, matchNumber) =>
                          setOrphanTarget({ orphanId, match, matchNumber })
                      : undefined
                  }
                  canRevert={canRevertFinish}
                  onRevertClick={handleRevertClick}
                  getInsight={getInsight}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 「未設定」の修復（作成者・開発モードのみ） */}
      {orphanTarget && (
        <OrphanPlayerAssignModal
          matchNumber={orphanTarget.matchNumber}
          orphanMatchCount={countOrphanMatches(matchHistory, orphanTarget.orphanId)}
          players={players}
          idsInMatch={[...orphanTarget.match.teamA, ...orphanTarget.match.teamB].filter(Boolean)}
          onConfirm={handleAssignOrphan}
          onCancel={() => setOrphanTarget(null)}
        />
      )}

      {/* 「コートに戻す」確認ダイアログ */}
      {revertTarget && (
        <ConfirmDialog
          title="この試合をコートに戻しますか？"
          message={buildRevertConfirmMessage(revertTarget)}
          confirmLabel="コートに戻す"
          cancelLabel="キャンセル"
          onConfirm={() => void handleRevertConfirm()}
          onCancel={() => setRevertTarget(null)}
        />
      )}

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
