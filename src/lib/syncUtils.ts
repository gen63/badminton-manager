/**
 * Firebase同期ユーティリティ関数
 * テスト可能な純粋関数として抽出
 */

/**
 * マージ用の汎用GameState型
 * 各エンティティはIDフィールドを持つオブジェクトの配列
 */
export type SyncGameState = {
  players: { id: string }[];
  courts: { id: number }[];
  matchHistory: { id: string; startedAt?: number }[];
  reservations: { id: string }[];
  settings?: Record<string, unknown>;
};

/**
 * Firestoreタイムスタンプをミリ秒に変換（堅牢版）
 * @returns ミリ秒、または取得失敗時はnull
 */
export function getTimestampMillis(timestamp: unknown): number | null {
  if (!timestamp) {
    return null;
  }
  
  // 数値（ミリ秒）の場合
  if (typeof timestamp === 'number') {
    return timestamp;
  }
  
  // Firestore Timestamp型
  if (typeof timestamp === 'object' && timestamp !== null) {
    // toMillis()メソッドがあれば使用（推奨）
    if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function') {
      return (timestamp as { toMillis(): number }).toMillis();
    }
    // secondsフィールドで変換（フォールバック）
    if ('seconds' in timestamp && typeof timestamp.seconds === 'number') {
      return (timestamp as { seconds: number }).seconds * 1000;
    }
  }
  
  return null;
}

/**
 * データのハッシュを計算（簡易版）
 */
export function hashGameState(data: {
  players: unknown[];
  courts: unknown[];
  matchHistory: unknown[];
  reservations: unknown[];
  settings?: unknown;
}): string {
  return JSON.stringify(data);
}

/**
 * リモートデータを適用すべきか判定
 * 
 * @param incomingHash 受信データのハッシュ
 * @param lastPushedHash 最後にpushしたデータのハッシュ
 * @param remoteUpdatedAt リモートデータの更新時刻（ミリ秒）
 * @param lastAppliedRemoteUpdatedAt 最後に適用したリモートデータの更新時刻（ミリ秒）
 * @param lastPushedTime 最後にpushした時刻（ミリ秒）
 * @param currentTime 現在時刻（ミリ秒）
 * @param pushBlockMs push後のブロック時間（ミリ秒）
 * @returns { shouldApply: boolean, reason?: string }
 */
export function shouldApplyRemoteData(params: {
  incomingHash: string;
  lastPushedHash: string;
  remoteUpdatedAt: number;
  lastAppliedRemoteUpdatedAt: number;
  lastPushedTime: number;
  currentTime: number;
  pushBlockMs?: number;
}): { shouldApply: boolean; reason?: string } {
  const {
    incomingHash,
    lastPushedHash,
    remoteUpdatedAt,
    lastAppliedRemoteUpdatedAt,
    lastPushedTime,
    currentTime,
    pushBlockMs = 500,
  } = params;

  // 自分が最後にpushしたデータと同じなら無視
  if (incomingHash === lastPushedHash) {
    return { shouldApply: false, reason: 'same as last push' };
  }

  // リモートデータが古い（または同じ）なら無視
  if (lastAppliedRemoteUpdatedAt > 0 && remoteUpdatedAt <= lastAppliedRemoteUpdatedAt) {
    return { 
      shouldApply: false, 
      reason: `older remote data (${remoteUpdatedAt} <= ${lastAppliedRemoteUpdatedAt})`,
    };
  }

  // 最後のpush操作から短時間以内なら無視（自分の操作を優先）
  const timeSinceLastPush = currentTime - lastPushedTime;
  if (timeSinceLastPush < pushBlockMs) {
    return { 
      shouldApply: false, 
      reason: `too soon after push (${timeSinceLastPush}ms < ${pushBlockMs}ms)`,
    };
  }

  return { shouldApply: true };
}

/**
 * IDベースの3-wayマージ（汎用）
 *
 * base（最後の同期状態）を基準に、ローカルで変更されたアイテムはlocal版を採用し、
 * ローカルで変更されていないアイテムはremote版を採用する。
 * これにより、他クライアントの変更を保持しつつ自分の変更を優先できる。
 */
function mergeById<T extends { id: string | number }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[] {
  if (!base) return local;

  const baseMap = new Map(base.map(item => [item.id, item]));
  const remoteMap = new Map(remote.map(item => [item.id, item]));

  const result: T[] = [];
  const seen = new Set<string | number>();

  // 1. ローカル配列の順序を基準にする
  for (const localItem of local) {
    seen.add(localItem.id);
    const baseItem = baseMap.get(localItem.id);
    const remoteItem = remoteMap.get(localItem.id);

    if (!remoteItem) {
      // リモートに存在しない
      if (!baseItem) {
        // baseにもない → ローカルで新規追加 → 追加
        result.push(localItem);
      }
      // baseにある → リモートで削除された → 削除（追加しない）
      continue;
    }

    // リモートにも存在する
    const localChanged = !baseItem || JSON.stringify(baseItem) !== JSON.stringify(localItem);
    if (localChanged) {
      result.push(localItem); // ローカル変更を優先
    } else {
      result.push(remoteItem); // ローカル未変更 → リモート版を採用
    }
  }

  // 2. リモートにのみ存在するアイテム（他クライアントが追加）
  for (const remoteItem of remote) {
    if (seen.has(remoteItem.id)) continue;
    seen.add(remoteItem.id);

    const baseItem = baseMap.get(remoteItem.id);
    if (!baseItem) {
      // baseにもない → リモートで新規追加 → 追加
      result.push(remoteItem);
    }
    // baseにある → ローカルで削除された → 削除（追加しない）
  }

  return result;
}

/**
 * Court 用の最低限の構造（id + チーム配列 + 任意の追加フィールド）
 * `mergeCourt` / `mergeCourts` 内で使用する。
 */
type CourtLike = {
  id: number;
  teamA?: [string, string] | string[];
  teamB?: [string, string] | string[];
  restingPlayerIds?: string[];
  [key: string]: unknown;
};

/**
 * チーム配列をポジション単位で 3-way マージ
 *
 * teamA / teamB は固定長（2）の player ID 配列。
 * 異なるポジションへの変更が並行して行われた場合に両方を保持するため、
 * 配列全体ではなく各ポジションを独立に 3-way マージする。
 */
function mergeTeam(
  base: string[] | undefined,
  local: string[] | undefined,
  remote: string[] | undefined,
): [string, string] {
  const get = (arr: string[] | undefined, i: number) => (arr?.[i] ?? '') as string;
  const result: [string, string] = ['', ''];
  for (let i = 0; i < 2; i++) {
    const b = get(base, i);
    const l = get(local, i);
    const r = get(remote, i);
    // local が base から変わっていれば local 優先、そうでなければ remote
    result[i] = l !== b ? l : r;
  }
  return result;
}

/**
 * restingPlayerIds（順序を持たない ID 集合）の 3-way マージ
 *
 * - base→local で追加された ID は維持（local が追加した）
 * - base→local で削除された ID は除外（local が削除した）
 * - それ以外は remote 反映（他クライアントの追加・削除を保持）
 */
function mergeRestingIds(
  base: string[] | undefined,
  local: string[] | undefined,
  remote: string[] | undefined,
): string[] | undefined {
  if (local === undefined && remote === undefined) return undefined;
  const baseSet = new Set(base ?? []);
  const localSet = new Set(local ?? []);
  const remoteSet = new Set(remote ?? []);

  const localAdded = [...localSet].filter((id) => !baseSet.has(id));
  const localRemoved = new Set([...baseSet].filter((id) => !localSet.has(id)));

  const result = new Set(remoteSet);
  for (const id of localAdded) result.add(id);
  for (const id of localRemoved) result.delete(id);

  return Array.from(result);
}

/**
 * Court オブジェクトのフィールド粒度 3-way マージ
 *
 * teamA/teamB はポジション単位、restingPlayerIds は集合単位、
 * その他のフィールド（isPlaying / startedAt / scoreA 等）はスカラ 3-way。
 */
function mergeCourt<T extends CourtLike>(base: T | undefined, local: T, remote: T): T {
  const result: Record<string, unknown> = { ...remote };

  // teamA / teamB: ポジション単位 3-way
  result.teamA = mergeTeam(base?.teamA as string[] | undefined, local.teamA as string[] | undefined, remote.teamA as string[] | undefined);
  result.teamB = mergeTeam(base?.teamB as string[] | undefined, local.teamB as string[] | undefined, remote.teamB as string[] | undefined);

  // restingPlayerIds: 集合 3-way
  const merged = mergeRestingIds(base?.restingPlayerIds, local.restingPlayerIds, remote.restingPlayerIds);
  if (merged === undefined) {
    delete result.restingPlayerIds;
  } else {
    result.restingPlayerIds = merged;
  }

  // その他フィールド: scalar 3-way（teamA/teamB/restingPlayerIds/id 以外）
  const handledKeys = new Set(['teamA', 'teamB', 'restingPlayerIds', 'id']);
  const allKeys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of allKeys) {
    if (handledKeys.has(key)) continue;
    const baseVal = base?.[key];
    const localVal = local[key];
    const remoteVal = remote[key];
    const localChanged = !base || JSON.stringify(baseVal) !== JSON.stringify(localVal);
    result[key] = localChanged ? localVal : remoteVal;
  }

  result.id = local.id;
  return result as T;
}

/**
 * courts 配列の 3-way マージ + コート横断重複除去
 *
 * 1. local の順序を保ちながら、3者にあるコートは `mergeCourt` でフィールド粒度マージ。
 * 2. local のみのコート（追加） / base にあって remote から消えたコート（削除）の
 *    扱いは `mergeById` と同等（自分の追加は維持、他者の削除は反映）。
 * 3. 最後にコート横断で同一プレイヤー ID の重複を解消する。
 *    - 各プレイヤー ID は teamA/teamB 全体で最大 1 ヶ所のみに存在すべき。
 *    - 重複時は `dedupPlayersAcrossCourts` の優先度（試合中 → remote-sourced
 *      → court.id 小）に従って残す位置を決め、他方のスロットを '' にする。
 */
function mergeCourts<T extends CourtLike>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[] {
  // base が無い場合は local をそのまま返すが、重複除去は実行する
  const baseList = base ?? [];
  const baseMap = new Map(baseList.map((c) => [c.id, c]));
  const localMap = new Map(local.map((c) => [c.id, c]));
  const remoteMap = new Map(remote.map((c) => [c.id, c]));

  const result: T[] = [];
  const seen = new Set<number>();

  // 1. local の順序を基準
  for (const localItem of local) {
    seen.add(localItem.id);
    const baseItem = baseMap.get(localItem.id);
    const remoteItem = remoteMap.get(localItem.id);

    if (!remoteItem) {
      // リモートに存在しない
      if (!baseItem) {
        // base にもない → ローカルで新規追加 → 追加
        result.push(localItem);
      }
      // base にある → リモートで削除された → 削除（追加しない）
      continue;
    }

    if (!base) {
      // base が無い場合は local 側を採用（mergeById 互換）
      result.push(localItem);
      continue;
    }

    // 3者にあるケースはフィールド粒度マージ
    result.push(mergeCourt(baseItem, localItem, remoteItem));
  }

  // 2. リモートにのみ存在するコート（他クライアントが追加）
  for (const remoteItem of remote) {
    if (seen.has(remoteItem.id)) continue;
    seen.add(remoteItem.id);
    const baseItem = baseMap.get(remoteItem.id);
    if (!baseItem) {
      result.push(remoteItem);
    }
    // base にある → ローカルで削除 → 追加しない
  }

  // 3. コート横断で同一プレイヤー ID の重複を解消
  return dedupPlayersAcrossCourts(result, baseMap, localMap);
}

/**
 * teamA/teamB 全体で同じプレイヤー ID が複数コートに存在しないようにする。
 *
 * 重複時は以下の優先度で「残す位置」を決定:
 *   1. **isPlaying のコート（試合中はロック扱い）**
 *      → 試合中のメンバーを抜くと進行中の試合を破壊するため最優先で保持
 *   2. **remote-sourced な位置（他クライアントが既に Firestore に書いた配置）**
 *      → `mergeTeam` で `l === b` のため remote の値を採用した位置。
 *        他クライアントの prior write を尊重する。これにより、未認識の
 *        並行配置 (e.g., A が court1 配置 push 後、B が court2 に同じ
 *        メンバーを配置) が dedup で先方の配置を空にしてしまう
 *        「巻き戻り」を防ぐ。
 *   3. local-sourced な位置（base と異なる local 側の変更）
 *   4. 同点なら court.id の小さい方
 * 残さない側のコート上の該当スロットは '' に置換する。
 *
 * 典型例: A が「開始」した直後、B が古い待機リストから同メンバーを別コートへ
 * 一括配置して push。3-way merge 結果は両コートにそのメンバーが乗るが、
 * isPlaying のコートを優先することで試合中コートを守る。
 */
function dedupPlayersAcrossCourts<T extends CourtLike>(
  courts: T[],
  baseMap: Map<number, T>,
  localMap: Map<number, T>,
): T[] {
  // マージ後の isPlaying（merged courts の値を信頼）
  const playingCourts = new Set<number>();
  for (const court of courts) {
    if (court.isPlaying === true) playingCourts.add(court.id);
  }

  // playerId -> 出現位置のリスト
  // source: 各位置の値が「remote 由来」か「local 由来」か。
  // mergeTeam の規則 `l !== b ? l : r` に従い、base[i] と local[i] が
  // 異なる位置は local が値を確定させた → 'local'。
  // base[i] === local[i] の位置は remote の値が採用された → 'remote'
  // （base/local/remote が全て同値の "stable" も remote 扱いに含める）。
  type Pos = { courtId: number; team: 'teamA' | 'teamB'; index: 0 | 1; source: 'remote' | 'local' };
  const occurrences = new Map<string, Pos[]>();

  for (const court of courts) {
    const baseCourt = baseMap.get(court.id);
    const localCourt = localMap.get(court.id);
    for (const team of ['teamA', 'teamB'] as const) {
      const arr = (court[team] as string[] | undefined) ?? ['', ''];
      const baseArr = (baseCourt?.[team] as string[] | undefined) ?? ['', ''];
      const localArr = (localCourt?.[team] as string[] | undefined) ?? ['', ''];
      for (let i = 0; i < 2; i++) {
        const pid = arr[i];
        if (!pid) continue;
        const basePos = baseArr[i] ?? '';
        const localPos = localArr[i] ?? '';
        const source: 'remote' | 'local' = localPos !== basePos ? 'local' : 'remote';
        const list = occurrences.get(pid) ?? [];
        list.push({ courtId: court.id, team, index: i as 0 | 1, source });
        occurrences.set(pid, list);
      }
    }
  }

  // 重複があれば、残すコート以外を空にする
  const courtsById = new Map(courts.map((c) => [c.id, { ...c, teamA: [...((c.teamA as string[] | undefined) ?? ['', ''])] as string[], teamB: [...((c.teamB as string[] | undefined) ?? ['', ''])] as string[] }]));
  let modified = false;

  for (const [, positions] of occurrences) {
    if (positions.length <= 1) continue;
    modified = true;
    // 残す位置を決定
    const sorted = [...positions].sort((a, b) => {
      // 優先度1: 試合中のコート
      const aPlaying = playingCourts.has(a.courtId) ? 1 : 0;
      const bPlaying = playingCourts.has(b.courtId) ? 1 : 0;
      if (aPlaying !== bPlaying) return bPlaying - aPlaying;
      // 優先度2: remote-sourced（他クライアントが Firestore に書いた authoritative 配置）
      const aRemote = a.source === 'remote' ? 1 : 0;
      const bRemote = b.source === 'remote' ? 1 : 0;
      if (aRemote !== bRemote) return bRemote - aRemote;
      // 優先度3: court.id 小さい方
      return a.courtId - b.courtId;
    });
    // sorted[0] は残し、それ以外のスロットを空にする
    for (const pos of sorted.slice(1)) {
      const c = courtsById.get(pos.courtId);
      if (!c) continue;
      const arr = c[pos.team] as string[];
      arr[pos.index] = '';
    }
  }

  if (!modified) return courts;

  // 元の順序を保ちつつ、書き換えた配列を反映
  return courts.map((c) => {
    const updated = courtsById.get(c.id);
    if (!updated) return c;
    return {
      ...c,
      teamA: [updated.teamA[0] ?? '', updated.teamA[1] ?? ''] as [string, string],
      teamB: [updated.teamB[0] ?? '', updated.teamB[1] ?? ''] as [string, string],
    } as T;
  });
}

/**
 * matchHistory専用マージ（和集合 + 時系列ソート）
 *
 * matchHistoryはappend-onlyの性質を持つため、IDベースの和集合で十分。
 * ローカルで変更（スコア編集等）されたものはローカル版を優先。
 */
function mergeMatchHistory<T extends { id: string; startedAt?: number }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[] {
  if (!base) return local;

  const baseMap = new Map(base.map(m => [m.id, m]));
  const localMap = new Map(local.map(m => [m.id, m]));
  const result = new Map<string, T>();

  // ローカルのアイテムを追加（変更含む）
  for (const item of local) {
    result.set(item.id, item);
  }

  // リモートのアイテムを追加（ローカルに無いもの、かつローカルで削除されていないもの）
  for (const remoteItem of remote) {
    if (result.has(remoteItem.id)) {
      // 両方にある場合: ローカルで変更されていればローカル版、そうでなければリモート版
      const baseItem = baseMap.get(remoteItem.id);
      const localItem = localMap.get(remoteItem.id)!;
      const localChanged = !baseItem || JSON.stringify(baseItem) !== JSON.stringify(localItem);
      if (!localChanged) {
        result.set(remoteItem.id, remoteItem);
      }
    } else {
      // ローカルに無い場合
      const baseItem = baseMap.get(remoteItem.id);
      if (!baseItem) {
        // baseにも無い → リモートで新規追加 → 追加
        result.set(remoteItem.id, remoteItem);
      }
      // baseにある → ローカルで削除 → 追加しない
    }
  }

  return Array.from(result.values()).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

/**
 * settings オブジェクトのフィールド単位 3-way マージ
 *
 * - base→local で変更があったキー: local の値を採用（ユーザーの変更を優先）
 * - base→local で変更がないキー: remote の値を採用（他クライアントの変更を保持）
 *
 * これにより、ユーザー A が practiceType を変更している最中にユーザー B が
 * recordScores を変更した場合でも、両者の変更がマージされる。
 */
function mergeSettings(
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!local && !remote) return undefined;
  if (!local) return remote;
  if (!remote) return local;

  const result: Record<string, unknown> = {};
  const keys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  for (const key of keys) {
    const baseVal = base?.[key];
    const localVal = local[key];
    const remoteVal = remote[key];

    const localChanged = !base || JSON.stringify(baseVal) !== JSON.stringify(localVal);
    const value = localChanged ? localVal : remoteVal;
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 3-wayマージ: base（最後の同期状態）をもとに、ローカル変更をリモートに適用
 *
 * - base→localで変更されたアイテム: local版を採用
 * - base→localで変更なしのアイテム: remote版を採用（他クライアントの変更を保持）
 * - baseがnullの場合: localをそのまま返す（初回push、後方互換）
 */
export function mergeGameState(
  base: SyncGameState | null,
  local: SyncGameState,
  remote: SyncGameState,
): SyncGameState {
  if (!base) return local;

  return {
    players: mergeById(base.players, local.players, remote.players),
    courts: mergeCourts(
      base.courts as unknown as CourtLike[],
      local.courts as unknown as CourtLike[],
      remote.courts as unknown as CourtLike[],
    ) as unknown as typeof local.courts,
    matchHistory: mergeMatchHistory(base.matchHistory, local.matchHistory, remote.matchHistory),
    reservations: mergeById(base.reservations, local.reservations, remote.reservations),
    settings: mergeSettings(base.settings, local.settings, remote.settings),
  };
}
