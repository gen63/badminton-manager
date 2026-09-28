import { useMemo } from 'react';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import type { PairPreference } from '../types/pairPreference';
import type { Session } from '../types/session';
import { EMPTY_PREDICTION, predictNextMatchPlayers, type NextMatchPrediction } from '../lib/nextMatchPrediction';
import { isPastEndOverrideActive, isPastLastCall, resolvePracticeEndTime } from '../lib/practiceEndPhase';
import { usePracticeEndPhase } from './usePracticeEndPhase';
import { useSettingsStore } from '../stores/settingsStore';

export interface UseNextMatchPredictionArgs {
  session: Session | null;
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  useStayDurationPriority: boolean;
  gameMode: 'singles' | 'doubles';
  lateBalanceMode?: boolean;
  genderBalanceMode?: boolean;
  reservationBlockThreshold?: number;
  pairPreferences?: PairPreference[];
}

export interface UseNextMatchPredictionResult {
  /** 次の試合に入るメンバーの予測（配置アルゴリズムの空打ち） */
  prediction: NextMatchPrediction;
  /** 練習終了20分前を過ぎている（延長中は false） */
  pastLastCall: boolean;
}

/**
 * 「次の試合に入るメンバー」の予測を、練習終了間際の停止判定込みで算出する。
 *
 * 空きコートがあればその配置結果、全コート稼働中はプレイ中の各コートが終わった
 * ケースを全部シミュレートし、全ケース共通 = ほぼ確定 / 一部のみ = 候補とする
 * （`predictNextMatchPlayers` 参照）。終了20分前以降は次の試合が無いので予測を
 * 空にする。これで予測バー・待機ガイド・呼び出し通知が止まり、終了操作も
 * 誰でもできる（担当不在時のフォールバック）。
 *
 * 元は `MainPage` にのみあったロジックを、`HistoryPage`（「コートに戻す」の権限
 * 判定 `canFinishGame` に必要）でも使うため切り出した。
 * 詳細: docs/plans/2026-09-28-remove-undo-revert-finish.md
 */
export function useNextMatchPrediction(
  args: UseNextMatchPredictionArgs,
): UseNextMatchPredictionResult {
  const {
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
  } = args;

  const practiceEndTime = resolvePracticeEndTime(session?.config);
  const practiceEndPhase = usePracticeEndPhase(practiceEndTime);
  // 作成者（開発モード含む）が終了20分前以降に連続モードを ON にした「延長」中は、
  // 終了前の停止（予測を空にする等）を行わない。
  const continuousPastEndOverrideFor = useSettingsStore((s) => s.continuousPastEndOverrideFor);
  const practiceExtended = isPastEndOverrideActive(continuousPastEndOverrideFor, practiceEndTime);
  const pastLastCall = isPastLastCall(practiceEndPhase) && !practiceExtended;

  // 配置アルゴリズムの空打ちで重いので、入力が変わったときだけ再計算する
  // （MainPage はタイマー等で頻繁に再描画される）。
  const practiceStartTime = session?.config.practiceStartTime;
  const prediction = useMemo(
    () => pastLastCall
      ? EMPTY_PREDICTION
      : predictNextMatchPlayers(players, courts, matchHistory, reservations, {
          practiceStartTime,
          useStayDurationPriority,
          gameMode,
          lateBalanceMode,
          genderBalanceMode,
          reservationBlockThreshold,
          pairPreferences,
        }),
    [pastLastCall, players, courts, matchHistory, reservations, practiceStartTime,
      useStayDurationPriority, gameMode, lateBalanceMode, genderBalanceMode,
      reservationBlockThreshold, pairPreferences],
  );

  return { prediction, pastLastCall };
}
