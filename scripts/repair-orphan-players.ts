/**
 * 削除されたプレイヤーによる「未設定」表示の修復スクリプト（一回限りの運用ツール）
 *
 * 背景: オートセッションの出欠同期が試合開始後にメンバーを削除していた時期があり
 * （修正: docs/plans/2026-08-15-auto-session-sync-no-removal-after-start.md）、
 * `gameState.players` から消されたプレイヤーの ID が `matchHistory` に残ったまま
 * 名前を引けず「未設定」と表示される。**試合記録そのもの（スコア・時刻・勝敗・
 * 出場者の ID）は消えていない**ので、プレイヤーレコードを復元すれば直る。
 *
 * 使い方（既定は dry-run。書き込みには --apply が必要）:
 *
 *   # 1. 診断（読み取りのみ）。宙に浮いた ID と、その人が出た試合・同僚を出す
 *   tsx scripts/repair-orphan-players.ts <sessionId>
 *
 *   # 2a. 復活: 宙に浮いた ID のままプレイヤーを作り直す（推奨）
 *   tsx scripts/repair-orphan-players.ts <sessionId> --restore <id>=<名前> [--rating <id>=<数値>] --apply
 *
 *   # 2b. 付け替え: 本人が既に手動で再追加済みなら、旧 ID を新 ID に差し替える
 *   tsx scripts/repair-orphan-players.ts <sessionId> --remap <旧id>=<新id または 名前> --apply
 *
 * 環境変数: VITE_FIREBASE_*（auto-create-session.ts と同じ）
 */

import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { GameState } from '../src/services/sessionService';
import type { Player } from '../src/types/player';
import type { Match } from '../src/types/match';

export {
  collectReferencedIds,
  findOrphanIds,
  describeOrphan,
  buildRestoredPlayer,
  remapPlayerId,
  findCandidateNames,
  parseAssignments,
};

// ============================================================
// 純粋関数（テスト対象）
// ============================================================

/** matchHistory / courts / reservations から参照されている全プレイヤー ID */
function collectReferencedIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  const add = (id: string) => {
    if (id) ids.add(id);
  };
  for (const m of state.matchHistory ?? []) {
    [...m.teamA, ...m.teamB].forEach(add);
  }
  for (const c of state.courts ?? []) {
    [...c.teamA, ...c.teamB, ...(c.restingPlayerIds ?? [])].forEach(add);
  }
  for (const r of state.reservations ?? []) {
    r.playerIds.forEach(add);
  }
  return ids;
}

/** 参照されているのに players に存在しない ID（＝削除されたプレイヤー） */
function findOrphanIds(state: GameState): string[] {
  const known = new Set(state.players.map((p) => p.id));
  return [...collectReferencedIds(state)].filter((id) => !known.has(id));
}

interface OrphanDescription {
  id: string;
  /** その ID が出場した試合（新しい順） */
  matches: { at: number; courtId: number; score: string; teammates: string[]; opponents: string[] }[];
  /** 同じ試合に出ていた「名前の分かる人」（誰なのかの手掛かり） */
  knownCompanions: string[];
  onCourt: boolean;
  inReservation: boolean;
}

/**
 * 宙に浮いた ID が「誰なのか」を人が特定するための材料を集める。
 * 一緒に出た人の名前が分かれば、当日の記憶や Discord の同期通知
 * （➖ 削除: の一覧）と突き合わせて本人を同定できる。
 */
function describeOrphan(state: GameState, orphanId: string): OrphanDescription {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? `?(${id.slice(0, 8)})`;
  const companions = new Set<string>();
  const matches = (state.matchHistory ?? [])
    .filter((m) => [...m.teamA, ...m.teamB].includes(orphanId))
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .map((m) => {
      const mine = m.teamA.includes(orphanId) ? m.teamA : m.teamB;
      const theirs = m.teamA.includes(orphanId) ? m.teamB : m.teamA;
      const teammates = mine.filter((id) => id && id !== orphanId).map(nameOf);
      const opponents = theirs.filter((id) => id).map(nameOf);
      [...teammates, ...opponents].filter((n) => !n.startsWith('?(')).forEach((n) => companions.add(n));
      return {
        at: m.finishedAt,
        courtId: m.courtId,
        score: `${m.scoreA}-${m.scoreB}`,
        teammates,
        opponents,
      };
    });

  return {
    id: orphanId,
    matches,
    knownCompanions: [...companions],
    onCourt: (state.courts ?? []).some((c) =>
      [...c.teamA, ...c.teamB, ...(c.restingPlayerIds ?? [])].includes(orphanId),
    ),
    inReservation: (state.reservations ?? []).some((r) => r.playerIds.includes(orphanId)),
  };
}

/** 試合履歴から算出した出場試合数 */
function countMatches(matchHistory: Match[], playerId: string): number {
  return matchHistory.filter((m) => [...m.teamA, ...m.teamB].includes(playerId)).length;
}

/**
 * 宙に浮いた ID をそのまま使ってプレイヤーを復元する。
 * `gamesPlayed` / `lastPlayedAt` は履歴から再計算する（保存値は失われているため）。
 * 支払い・名簿の対応状況（`operationStatus` / `paymentAmount`）は履歴から復元できないので
 * 未設定になる。必要なら会計画面で入れ直す。
 */
function buildRestoredPlayer(
  state: GameState,
  orphanId: string,
  name: string,
  options: { rating?: number; gender?: 'M' | 'F' } = {},
): Player {
  const history = state.matchHistory ?? [];
  const played = history.filter((m) => [...m.teamA, ...m.teamB].includes(orphanId));
  const lastPlayedAt = played.reduce((max, m) => Math.max(max, m.finishedAt), 0);
  const onCourt = (state.courts ?? []).some((c) =>
    [...c.teamA, ...c.teamB].includes(orphanId),
  );
  return {
    id: orphanId,
    name,
    ...(options.rating != null && { rating: options.rating }),
    ...(options.gender && { gender: options.gender }),
    // コートに乗っているなら出場中、それ以外は休憩（勝手に配置対象へ戻さない）
    isResting: !onCourt,
    gamesPlayed: played.length,
    lastPlayedAt,
    activatedAt: 0,
  };
}

/**
 * 旧 ID の参照を新 ID へ差し替える（本人が既に手動で再追加済みのケース）。
 * 新 ID のプレイヤーの `gamesPlayed` は差し替え後の履歴から再計算する。
 */
function remapPlayerId(state: GameState, oldId: string, newId: string): GameState {
  const swap = (id: string) => (id === oldId ? newId : id);
  const swapPair = (pair: [string, string]): [string, string] => [swap(pair[0]), swap(pair[1])];

  const matchHistory = (state.matchHistory ?? []).map((m) => ({
    ...m,
    teamA: swapPair(m.teamA),
    teamB: swapPair(m.teamB),
  }));

  const courts = (state.courts ?? []).map((c) => ({
    ...c,
    teamA: swapPair(c.teamA),
    teamB: swapPair(c.teamB),
    ...(c.restingPlayerIds && { restingPlayerIds: c.restingPlayerIds.map(swap) }),
  }));

  const reservations = (state.reservations ?? []).map((r) => ({
    ...r,
    // 旧 ID と新 ID が同じ予約に同居しないよう重複を潰す
    playerIds: [...new Set(r.playerIds.map(swap))],
  }));

  const gamesPlayed = countMatches(matchHistory, newId);
  const lastPlayedAt = matchHistory
    .filter((m) => [...m.teamA, ...m.teamB].includes(newId))
    .reduce((max, m) => Math.max(max, m.finishedAt), 0);

  return {
    ...state,
    players: state.players.map((p) =>
      p.id === newId ? { ...p, gamesPlayed, lastPlayedAt: Math.max(p.lastPlayedAt, lastPlayedAt) } : p,
    ),
    matchHistory,
    courts,
    reservations,
  };
}

/**
 * セッションに名前だけ残っている「players に居ない人」を集める。
 * 同期は `participants` / `lastSeen` / `information.readBy` を触らないので、
 * 削除された人がアプリを開いていればここに名前が残っている＝復元名の候補になる。
 */
function findCandidateNames(
  session: {
    participants?: string[];
    registeredPlayers?: string[];
    lastSeen?: Record<string, number>;
    information?: { readBy?: string[] };
  },
  state: GameState,
): string[] {
  const known = new Set(state.players.map((p) => p.name));
  const names = [
    ...(session.participants ?? []),
    ...(session.registeredPlayers ?? []),
    ...Object.keys(session.lastSeen ?? {}),
    ...(session.information?.readBy ?? []),
  ];
  return [...new Set(names.filter((n) => !known.has(n)))];
}

/** `--restore id=名前` 形式の引数を Map にする */
function parseAssignments(args: string[], flag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== flag) continue;
    const pair = args[i + 1];
    if (!pair) throw new Error(`${flag} の値がありません`);
    const idx = pair.indexOf('=');
    if (idx <= 0 || idx === pair.length - 1) {
      throw new Error(`${flag} は <キー>=<値> の形式で指定してください: ${pair}`);
    }
    result.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return result;
}

// ============================================================
// I/O（Firestore）
// ============================================================

const sanitize = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

function formatTime(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function main() {
  const args = process.argv.slice(2);
  // セッション ID は第1引数固定（フラグより前）
  const sessionId = args[0]?.startsWith('--') ? undefined : args[0];
  if (!sessionId) {
    console.error('使い方: tsx scripts/repair-orphan-players.ts <sessionId> [--restore id=名前] [--remap 旧id=新id|名前] [--rating id=数値] [--apply]');
    process.exit(1);
  }
  const apply = args.includes('--apply');
  const restores = parseAssignments(args, '--restore');
  const remaps = parseAssignments(args, '--remap');
  const ratings = parseAssignments(args, '--rating');

  const app = initializeApp({
    apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('VITE_FIREBASE_APP_ID'),
  });
  const db = getFirestore(app);

  try {
    const docRef = doc(db, 'sessions', sessionId);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) throw new Error(`セッション ${sessionId} が見つかりません`);
      const data = snap.data();
      const state = data.gameState as GameState | undefined;
      if (!state) throw new Error(`セッション ${sessionId} に gameState がありません`);

      const orphans = findOrphanIds(state);
      console.log(`\n=== セッション ${sessionId} ===`);
      console.log(`プレイヤー: ${state.players.length}名 / 試合履歴: ${(state.matchHistory ?? []).length}件`);
      console.log(`宙に浮いた ID: ${orphans.length}件`);

      for (const id of orphans) {
        const d = describeOrphan(state, id);
        console.log(`\n- ${id}`);
        console.log(`  出場試合: ${d.matches.length}件 / コート上: ${d.onCourt ? 'あり' : 'なし'} / 予約: ${d.inReservation ? 'あり' : 'なし'}`);
        for (const m of d.matches.slice(0, 10)) {
          console.log(`    ${formatTime(m.at)} C${m.courtId} ${m.score} 味方[${m.teammates.join(', ')}] 相手[${m.opponents.join(', ')}]`);
        }
        if (d.knownCompanions.length > 0) {
          console.log(`  同じ試合に出ていた人: ${d.knownCompanions.join(', ')}`);
        }
      }

      const candidates = findCandidateNames(data, state);
      if (candidates.length > 0) {
        console.log(`\nセッションに名前だけ残っている人（復元名の候補）: ${candidates.join(', ')}`);
      }

      if (restores.size === 0 && remaps.size === 0) {
        console.log('\n診断のみ（--restore / --remap の指定がありません）。書き込みは行いません。');
        return;
      }

      let next = state;
      for (const [oldId, target] of remaps) {
        // 値が既存プレイヤーの名前なら、その ID を解決する
        const byName = next.players.find((p) => p.name === target);
        const newId = byName?.id ?? target;
        if (!next.players.some((p) => p.id === newId)) {
          throw new Error(`付け替え先 ${target} に対応するプレイヤーが見つかりません`);
        }
        console.log(`\n[remap] ${oldId} → ${newId} (${byName?.name ?? ''})`);
        next = remapPlayerId(next, oldId, newId);
      }

      const restored: Player[] = [];
      for (const [id, name] of restores) {
        if (next.players.some((p) => p.id === id)) {
          throw new Error(`${id} は既に players に存在します`);
        }
        const ratingRaw = ratings.get(id);
        const rating = ratingRaw != null ? Number(ratingRaw) : undefined;
        if (ratingRaw != null && Number.isNaN(rating)) {
          throw new Error(`--rating ${id}=${ratingRaw} が数値ではありません`);
        }
        const player = buildRestoredPlayer(next, id, name, { rating });
        console.log(`\n[restore] ${id} → ${name}（試合数 ${player.gamesPlayed} / 最終 ${formatTime(player.lastPlayedAt)}）`);
        restored.push(player);
      }
      next = { ...next, players: [...next.players, ...restored] };

      const remainingOrphans = findOrphanIds(next);
      console.log(`\n修復後に残る宙に浮いた ID: ${remainingOrphans.length}件`);

      if (!apply) {
        console.log('dry-run のため書き込みません。問題なければ --apply を付けて再実行してください。');
        return;
      }

      transaction.update(docRef, {
        gameState: sanitize(next),
        registeredPlayers: next.players.map((p) => p.name),
        updatedAt: serverTimestamp(),
      });
      console.log('書き込みました。');
    });
  } finally {
    await deleteApp(app);
  }
}

// esm直接実行時のみmainを起動（auto-create-session.ts と同じ判定）
const isDirectRun =
  process.argv[1]?.includes('repair-orphan-players') && !process.argv[1]?.includes('.test.');

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
