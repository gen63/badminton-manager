/**
 * セッション管理サービス
 *
 * Phase 4 で Firestore 必須化。Firebase 未設定時は起動エラー（`db` が null
 * のため `requireDb()` で例外）。localStorage フォールバックは廃止済み。
 */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  FieldPath,
  deleteField,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session, PresenceEntry } from '../types/session';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError } from '../lib/errorHandler';
import { requireDb, sanitize } from '../lib/firestoreUtils';
import { medianGamesPlayed } from '../lib/median';
import { computeFirstMatchStartedAt, isSessionVisible } from '../lib/sessionArchive';
import { AUTO_SESSION_BOT_CREATOR } from '../constants/autoSession';

/** セッションレベルの設定（Firebase同期対象） */
export interface SyncSettings {
  recordScores?: boolean;
  continuousMatchMode?: boolean;
  practiceType?: '単' | '複' | '楽';
  /** 練習後半に試合回数の偏りを均等化するモード。 */
  lateBalanceMode?: boolean;
  /**
   * 配置の優先度モード。true = 待機時間（滞在時間）優先、false = 試合回数優先。
   * **未設定は `true` 扱い**（`assignCourts` の `?? true` / `settingsStore` の初期値と
   * 一致させる。`continuousMatchMode` の `?? false` とは既定が異なる）。
   *
   * セッション全体の配置挙動を決めるので端末ローカルではなく Firestore に持つ。
   * 端末ごとに違うと「試合終了を押した人の設定で連続配置のモードが変わる」ため。
   * 詳細: docs/plans/2026-08-11-stay-duration-mode-not-applied.md
   */
  useStayDurationPriority?: boolean;
  /**
   * 予約メンバーの試合数が「中央値 + この値」以上のとき、その予約全体を保留する閾値。
   * 試合数の多い人が予約で順番を飛ばし続けるのを防ぐフェアネス制限。未設定時は 2。
   */
  reservationBlockThreshold?: number;
  /**
   * 90 分自動オンが既に走ったかを示すフラグ。1 セッションにつき 1 度だけ
   * `markLateBalanceAutoFired` mutation で true になる。PWA 再起動などで
   * setTimeout が消失していても、未発火なら復帰時にすぐ発火させるための判定に使う。
   */
  lateBalanceAutoFired?: boolean;
}

/** ゲーム状態の型（Firestore同期用） */
export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  settings?: SyncSettings;
}

/** セッションID生成（6文字の英数字） */
function generateFirebaseSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * セッション一覧用の派生 incomeTotal を計算（純粋関数）。
 *
 * AccountingPage の calculateAccountingTotals と同じ「純収入」定義:
 * 男女会費合計 − 運営協力割引 + 寄付 + プラスのその他収入。
 * accounting 未設定なら undefined（一覧で非表示）。
 */
export function computeDerivedIncomeTotal(
  accounting: Session['accounting'],
  players: Player[],
): number | undefined {
  if (!accounting) return undefined;
  const maleFee = accounting.maleFee ?? 0;
  const femaleFee = accounting.femaleFee ?? 0;
  // 運営協力割引（標準会費より少なく払った差額）と寄付（多く払った差額）
  let discount = 0;
  let donation = 0;
  for (const p of players) {
    if (!p?.operationStatus?.payment) continue;
    const actual = p.paymentAmount ?? 0;
    if (actual === 0) continue;
    const expectedFee = p.gender === 'F' ? femaleFee : maleFee;
    const diff = expectedFee - actual;
    if (diff > 0) discount += diff;
    else if (diff < 0) donation += -diff;
  }
  const maleTotal = (accounting.maleCount ?? 0) * maleFee;
  const femaleTotal = (accounting.femaleCount ?? 0) * femaleFee;
  const otherAmount = accounting.otherAmount ?? 0;
  return maleTotal + femaleTotal - discount + donation + (otherAmount > 0 ? otherAmount : 0);
}

/** Firestoreドキュメントからセッションを変換 */
function docToSession(id: string, data: Record<string, unknown>): Session {
  const gameState = data.gameState as
    | {
        matchHistory?: unknown[];
        players?: Player[];
        settings?: { practiceType?: '単' | '複' | '楽'; recordScores?: boolean };
      }
    | undefined;
  const paidCount = Array.isArray(gameState?.players)
    ? gameState.players.filter((p) => p?.operationStatus?.payment === true).length
    : 0;
  const accounting = data.accounting as Session['accounting'];
  const incomeTotal = computeDerivedIncomeTotal(accounting, gameState?.players ?? []);
  return {
    id,
    config: data.config as Session['config'],
    createdAt: typeof data.createdAt === 'number'
      ? data.createdAt
      : (data.createdAt as { seconds: number })?.seconds * 1000 || Date.now(),
    updatedAt: typeof data.updatedAt === 'number'
      ? data.updatedAt
      : (data.updatedAt as { seconds: number })?.seconds * 1000 || Date.now(),
    createdBy: data.createdBy as string | undefined,
    participants: data.participants as string[] | undefined,
    registeredPlayers: data.registeredPlayers as string[] | undefined,
    admins: data.admins as string[] | undefined,
    status: data.status as Session['status'],
    information: data.information as Session['information'],
    accounting: data.accounting as Session['accounting'],
    matchUpload: data.matchUpload as Session['matchUpload'],
    accountingUpload: data.accountingUpload as Session['accountingUpload'],
    presence: data.presence as Session['presence'],
    lastSeen: data.lastSeen as Session['lastSeen'],
    firstMatchStartedAt: (data.firstMatchStartedAt as number | null | undefined) ?? null,
    matchCount: Array.isArray(gameState?.matchHistory) ? gameState.matchHistory.length : 0,
    paidCount,
    incomeTotal,
    medianGamesPlayed: medianGamesPlayed(gameState?.players ?? []),
    practiceType: gameState?.settings?.practiceType,
    recordScores: gameState?.settings?.recordScores,
  };
}

/**
 * セッションを作成する。
 *
 * `gameState` を同時に渡すと session document と gameState が **1 回の書き込み**
 * で揃う。これを渡さない場合は session のみ作成され、後から
 * `overwriteGameState` で gameState を初期化する必要がある（CON3 修正で
 * 同梱書き込みを推奨）。
 */
export async function createSession(
  session: Partial<Session>,
  gameState?: GameState,
): Promise<string> {
  const _db = requireDb();

  // セッションID衝突を避けるため、最大3回リトライ
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const sessionId = generateFirebaseSessionId();
    const docRef = doc(_db, 'sessions', sessionId);

    try {
      // 既存のセッションIDをチェック
      const existingDoc = await getDoc(docRef);
      if (existingDoc.exists()) {
        console.warn(`[SessionService] Session ID collision detected: ${sessionId}, retrying...`);
        continue; // 次のIDで再試行
      }

      // IDが未使用なら作成。gameState が渡されていれば同梱して 1 回の setDoc で
      // 全フィールドを一発書き込み（CON3 修正）。
      const payload: Record<string, unknown> = {
        ...session,
        id: sessionId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: session.status || 'active',
        participants: session.participants ?? [],
      };
      if (gameState) {
        payload.gameState = sanitize(gameState);
        payload.registeredPlayers = gameState.players.map((p) => p.name);
        payload.firstMatchStartedAt = computeFirstMatchStartedAt(gameState.matchHistory);
      }
      await setDoc(docRef, payload);

      return sessionId;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // 最後の試行で失敗
        console.error('Firebase write failed:', error);
        throw new SessionError(
          'セッションの作成に失敗しました。ネットワーク接続を確認してください。',
          'firebase-write-failed'
        );
      }
    }
  }

  // 3回すべて衝突した場合（極めて低確率）
  throw new SessionError(
    'セッションIDの生成に失敗しました。もう一度お試しください。',
    'id-generation-failed'
  );
}

/** セッションを取得 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const _db = requireDb();
  const docSnap = await getDoc(doc(_db, 'sessions', sessionId));
  if (!docSnap.exists()) return null;
  return docToSession(sessionId, docSnap.data());
}

/** セッションをリアルタイム監視 */
export function subscribeToSession(
  sessionId: string,
  callback: (session: Session | null) => void,
): () => void {
  const _db = requireDb();
  return onSnapshot(
    doc(_db, 'sessions', sessionId),
    (snap) => {
      if (snap.exists()) {
        callback(docToSession(sessionId, snap.data()));
      } else {
        callback(null);
      }
    },
    (error) => {
      console.error('Session subscription error:', error);
    },
  );
}

/** セッション状態を更新 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Session>,
): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
  });
}

export { AUTO_SESSION_BOT_CREATOR };

/** セッションに参加者を追加（トランザクションでgameState.playersにも追加） */
export async function joinSession(
  sessionId: string,
  playerName: string,
  options?: { gender?: 'M' | 'F' }
): Promise<{ newCreator?: string }> {
  if (!playerName.trim()) {
    throw new SessionError('参加者名を入力してください', 'invalid-name');
  }
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);

  return await runTransaction(_db, async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists()) {
      throw new SessionError(`セッション ${sessionId} が見つかりません`, 'not-found');
    }

    const data = snap.data();
    const participants = (data.participants as string[] | undefined) ?? [];

    // 既参加でも黙って再入室を許可（重複排除して末尾に追加）
    const newParticipants = [
      ...participants.filter((name) => name !== playerName),
      playerName,
    ];

    const updates: Record<string, unknown> = {
      participants: newParticipants,
      updatedAt: serverTimestamp(),
    };

    // bot 作成セッション: 最初にログインした人を作成者に自動昇格
    // transaction 内なので同時入室でも先着 1 人のみ昇格する
    let newCreator: string | undefined;
    if (data.createdBy === AUTO_SESSION_BOT_CREATOR) {
      updates.createdBy = playerName;
      newCreator = playerName;
    }

    // gameState.playersに未登録の場合、新規プレイヤーとして追加
    // dot notationでplayersのみ更新し、courts/matchHistory等を上書きしない
    const gameState = data.gameState as GameState | undefined;
    if (gameState) {
      const playerExists = gameState.players.some((p) => p.name === playerName);
      if (!playerExists) {
        const newPlayer: Player = {
          id: crypto.randomUUID(),
          name: playerName,
          gender: options?.gender,
          isResting: true,
          gamesPlayed: 0,
          lastPlayedAt: 0,
          activatedAt: 0,
        };
        const newPlayers = [...gameState.players, newPlayer];
        updates['gameState.players'] = sanitize(newPlayers);
        updates.registeredPlayers = newPlayers.map((p) => p.name);
      }
    }

    transaction.update(docRef, updates);
    return { newCreator };
  });
}

/**
 * participants から自分を除去する。createdBy は変更しない。
 *
 * fire-and-forget 用途（unmount cleanup / セッション切替時の旧セッション離脱）で
 * 呼ばれるため、Firebase 未設定や transaction 失敗は throw せず warn で握り潰す。
 */
export async function leaveSession(sessionId: string, playerName: string): Promise<void> {
  if (!sessionId || !playerName) return;
  if (!db) return;

  const docRef = doc(db, 'sessions', sessionId);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const participants = (data.participants as string[] | undefined) ?? [];
      if (!participants.includes(playerName)) return;
      transaction.update(docRef, {
        participants: participants.filter((name) => name !== playerName),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('[SessionService] leaveSession failed:', error);
  }
}

/** 作成者を変更（dev モード専用） */
export async function updateCreator(sessionId: string, newCreator: string): Promise<void> {
  if (!newCreator.trim()) {
    throw new SessionError('新しい作成者名を指定してください', 'invalid-name');
  }
  await updateSession(sessionId, { createdBy: newCreator });
}

/** ゲーム状態をFirestoreに同期（管理者が呼ぶ） */
export async function syncGameState(
  sessionId: string,
  gameState: GameState,
): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  const registeredPlayers = gameState.players.map((p) => p.name);
  await updateDoc(docRef, {
    gameState: sanitize(gameState),
    registeredPlayers,
    firstMatchStartedAt: computeFirstMatchStartedAt(gameState.matchHistory),
    updatedAt: serverTimestamp(), // Firestoreサーバー時刻（同期の基準時刻）
  });
}

/** ゲーム状態をリアルタイム監視（参加者が呼ぶ） */
export function subscribeToGameState(
  sessionId: string,
  callback: (gameState: GameState | null) => void,
): () => void {
  const _db = requireDb();
  return onSnapshot(
    doc(_db, 'sessions', sessionId),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.gameState) {
          callback(data.gameState as GameState);
        }
      }
    },
    (error) => {
      console.error('GameState subscription error:', error);
    },
  );
}

/**
 * 最近アクティブなセッション一覧をリアルタイム購読する（updatedAt 降順、
 * 最大 count 件）。一覧画面を開きっぱなしのときに新規作成・情報更新を検知する。
 *
 * - status フィルターなし（現状セッション終了機能が未実装で全セッションが active）
 * - 単一フィールド orderBy のみで複合インデックス不要
 * - 12h 自動アーカイブ判定はクライアント側でフィルタ（Firestore OR query を避ける）
 */
export function subscribeToRecentActiveSessions(
  count: number,
  options: { includeArchived?: boolean },
  onData: (sessions: Session[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const _db = requireDb();
  const q = query(
    collection(_db, 'sessions'),
    orderBy('updatedAt', 'desc'),
    limit(count),
  );
  const includeArchived = options.includeArchived === true;
  return onSnapshot(
    q,
    (snap) => {
      const sessions = snap.docs.map((d) => docToSession(d.id, d.data()));
      const filtered = includeArchived ? sessions : sessions.filter((s) => isSessionVisible(s));
      onData(filtered.sort((a, b) => b.config.practiceStartTime - a.config.practiceStartTime));
    },
    (error) => {
      console.error('Recent sessions subscription error:', error);
      onError?.(error);
    },
  );
}

/** セッションを削除（Firestoreドキュメントを完全削除） */
export async function deleteSession(sessionId: string): Promise<void> {
  const _db = requireDb();
  const docRef = doc(_db, 'sessions', sessionId);
  await deleteDoc(docRef);
}

/**
 * プレゼンスエントリを書き込み（fire-and-forget）
 *
 * - ユーザー名に `.` が含まれてもキー階層が壊れないよう `FieldPath` を使用
 * - `updatedAt` は意図的に更新しない（TTL カウントと onSnapshot 経路の無駄トリガを避けるため）
 * - Firestore 未設定 / 無効な引数 / 書き込み失敗 はすべて silent（warn）。
 *   ハートビート系は失敗してもアプリの主要機能を止めないことが優先。
 */
export async function writePresence(
  sessionId: string,
  username: string,
  patch: Partial<PresenceEntry>,
): Promise<void> {
  if (!db) return;
  if (!sessionId || !username) return;
  const entries = Object.entries(patch);
  if (entries.length === 0) return;

  const docRef = doc(db, 'sessions', sessionId);
  // updateDoc の可変長 (FieldPath, value)... 形式で書き込み
  const args: unknown[] = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    args.push(new FieldPath('presence', username, key), value);
  }
  if (args.length === 0) return;

  try {
    // 型: updateDoc(docRef, fieldPath, value, ...moreFieldsAndValues)
    await (updateDoc as (...args: unknown[]) => Promise<void>)(docRef, ...args);
  } catch (error) {
    console.warn('[Presence] writePresence failed:', error);
  }
}

/**
 * プレゼンスエントリを削除（unmount/非表示時、fire-and-forget）
 *
 * `writePresence` と同じく Firebase 未設定 / 失敗は silent（warn）。
 */
export async function clearPresence(sessionId: string, username: string): Promise<void> {
  if (!db) return;
  if (!sessionId || !username) return;

  const docRef = doc(db, 'sessions', sessionId);
  try {
    await (updateDoc as (...args: unknown[]) => Promise<void>)(
      docRef,
      new FieldPath('presence', username),
      deleteField(),
    );
  } catch (error) {
    console.warn('[Presence] clearPresence failed:', error);
  }
}

/**
 * 「最後にアプリ画面を見た時刻」を書き込み（fire-and-forget）
 *
 * `presence` と違い削除されない履歴フィールド。参加者管理ページの「放置検知」用途。
 * - ユーザー名に `.` が含まれてもキー階層が壊れないよう `FieldPath` を使用
 * - `updatedAt` は意図的に更新しない（TTL カウントと onSnapshot 経路の無駄トリガを避けるため）
 * - Firestore 未設定 / 無効な引数 / 書き込み失敗 はすべて silent（warn）。
 *   ハートビート系は失敗してもアプリの主要機能を止めないことが優先。
 */
export async function writeLastSeen(
  sessionId: string,
  username: string,
  at: number,
): Promise<void> {
  if (!db) return;
  if (!sessionId || !username) return;

  const docRef = doc(db, 'sessions', sessionId);
  try {
    await (updateDoc as (...args: unknown[]) => Promise<void>)(
      docRef,
      new FieldPath('lastSeen', username),
      at,
    );
  } catch (error) {
    console.warn('[LastSeen] writeLastSeen failed:', error);
  }
}

/**
 * 古いプレゼンスエントリを一括削除（漂流対策、fire-and-forget）
 *
 * マウント時に1回のみ呼び出す想定。`lastSeenAt` が閾値より古いエントリを
 * `deleteField` で削除。Firebase 未設定 / 失敗は silent（warn）。
 */
export async function pruneStalePresence(
  sessionId: string,
  staleUsernames: string[],
): Promise<void> {
  if (!db) return;
  if (!sessionId || staleUsernames.length === 0) return;

  const docRef = doc(db, 'sessions', sessionId);
  const args: unknown[] = [];
  for (const username of staleUsernames) {
    args.push(new FieldPath('presence', username), deleteField());
  }

  try {
    await (updateDoc as (...args: unknown[]) => Promise<void>)(docRef, ...args);
  } catch (error) {
    console.warn('[Presence] pruneStalePresence failed:', error);
  }
}
