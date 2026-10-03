import { useMemo, useState } from 'react';
import type { Player } from '../types/player';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { computeExpectedGames, computeStayStats } from '../lib/playerStats';
import { resolvePracticeEndTime } from '../lib/practiceEndPhase';

/**
 * 参加者の試合数まわりの派生値（滞在・期待試合数・コート上の人・基準時刻）を算出する。
 * 参加者管理画面と予約追加モーダルで共用する。
 *
 * `now` は画面（フックを使うコンポーネント）を開いた時点で1回だけ固定し、リアルタイムでは進めない。
 * 見ている最中に並びが入れ替わらないようにするため。players / courts / 設定が変わったときだけ
 * 固定した `now` を使って再計算する。
 */
export function usePlayerGameStats(players: Player[]) {
  const courts = useGameStore((s) => s.courts);
  const config = useSessionStore((s) => s.session?.config);
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const [now] = useState<number>(() => Date.now());

  const stayStats = useMemo(
    () =>
      // 滞在はアルゴリズムの resolveStayStart と同じ起点。練習終了時刻で頭打ち
      computeStayStats(players, config?.practiceStartTime ?? 0, now, resolvePracticeEndTime(config)),
    [players, config, now],
  );
  // 期待試合数と実績との差
  const expectedById = useMemo(
    () => computeExpectedGames(players, useStayDurationPriority ? 'stay' : 'count', stayStats.byId),
    [players, useStayDurationPriority, stayStats],
  );
  // 現在コートに入っているプレイヤーID（空スロットは除外）
  const inCourtIds = useMemo(
    () => new Set(courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())),
    [courts],
  );

  return { now, stayStats, stayById: stayStats.byId, expectedById, inCourtIds, useStayDurationPriority };
}
