/**
 * アプリ全体のグローバル設定サービス
 *
 * セッションに紐付かない設定を Firestore の `appConfig/global` document に
 * 保存する。現状はデフォルト周知事項とグローバル既定参加費。
 *
 * 注意: Firestore Security Rules（Firebase console 管理）に `appConfig` への
 * read/write 許可が必要。詳細: docs/plans/2026-07-09-default-announcement.md
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { requireDb } from '../lib/firestoreUtils';
import type { FeePair } from '../lib/accountingCalc';

/** デフォルト周知事項。新規セッション作成時に session.information へコピーされる */
export interface DefaultAnnouncement {
  text: string; // 空文字 = 未設定
  updatedAt: number;
  updatedBy?: string;
}

const CONFIG_COLLECTION = 'appConfig';
const CONFIG_DOC_ID = 'global';

/** デフォルト周知事項を取得（編集 UI 用。失敗は throw） */
export async function getDefaultAnnouncement(): Promise<DefaultAnnouncement | null> {
  const _db = requireDb();
  const snap = await getDoc(doc(_db, CONFIG_COLLECTION, CONFIG_DOC_ID));
  if (!snap.exists()) return null;
  const value = snap.data().defaultAnnouncement as DefaultAnnouncement | undefined;
  return value ?? null;
}

/** デフォルト周知事項を保存。空文字で「未設定」扱いになる */
export async function setDefaultAnnouncement(
  text: string,
  updatedBy?: string,
): Promise<void> {
  const _db = requireDb();
  const value: DefaultAnnouncement = {
    text: text.trim(),
    updatedAt: Date.now(),
    // undefined を含めると Firestore が例外を投げるため、あるときだけ差し込む
    ...(updatedBy ? { updatedBy } : {}),
  };
  await setDoc(
    doc(_db, CONFIG_COLLECTION, CONFIG_DOC_ID),
    { defaultAnnouncement: value },
    { merge: true },
  );
}

/**
 * デフォルト周知事項のテキストを取得する fail-safe 版（セッション作成経路用）。
 *
 * デフォルト周知事項が読めないこと（rules 未設定・ネットワーク断など）を理由に
 * セッション作成を失敗させないため、エラーは warn に落として '' を返す。
 */
export async function fetchDefaultAnnouncementTextSafe(): Promise<string> {
  try {
    const announcement = await getDefaultAnnouncement();
    return announcement?.text.trim() ?? '';
  } catch (error) {
    console.warn('[AppConfig] Failed to fetch default announcement:', error);
    return '';
  }
}

/**
 * グローバル既定参加費。`fees` は部分指定を許し、未設定の練習種別は
 * コード定数（`PRACTICE_TYPE_OPTIONS`）へフォールバックする。
 */
export type { FeePair };

export interface DefaultFees {
  fees: Record<string, FeePair>; // key = 練習種別（'複' | '単' | '楽'）
  updatedAt: number;
  updatedBy?: string;
}

/** 0 以上の整数のみ有効な金額として扱う */
function isValidFee(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Firestore から読んだ生データを検証済みの fees マップへ正規化 */
function normalizeFees(raw: unknown): Record<string, FeePair> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, FeePair> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const { maleFee, femaleFee } = value as Partial<FeePair>;
    if (isValidFee(maleFee) && isValidFee(femaleFee)) {
      result[key] = { maleFee, femaleFee };
    }
  }
  return result;
}

/** グローバル既定参加費を取得（編集 UI 用。失敗は throw） */
export async function getDefaultFees(): Promise<DefaultFees | null> {
  const _db = requireDb();
  const snap = await getDoc(doc(_db, CONFIG_COLLECTION, CONFIG_DOC_ID));
  if (!snap.exists()) return null;
  const value = snap.data().defaultFees as Partial<DefaultFees> | undefined;
  if (!value) return null;
  return {
    fees: normalizeFees(value.fees),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    ...(value.updatedBy ? { updatedBy: value.updatedBy } : {}),
  };
}

/**
 * グローバル既定参加費を保存。
 * 不正な金額（0 未満・非整数）を含む種別は保存対象から除外する。
 * 空の `fees` を渡せば「全種別未設定」＝コード定数へのフォールバックになる。
 */
export async function setDefaultFees(
  fees: Record<string, FeePair>,
  updatedBy?: string,
): Promise<void> {
  const _db = requireDb();
  const value: DefaultFees = {
    fees: normalizeFees(fees),
    updatedAt: Date.now(),
    // undefined を含めると Firestore が例外を投げるため、あるときだけ差し込む
    ...(updatedBy ? { updatedBy } : {}),
  };
  await setDoc(
    doc(_db, CONFIG_COLLECTION, CONFIG_DOC_ID),
    { defaultFees: value },
    { merge: true },
  );
}

/**
 * グローバル既定参加費を取得する fail-safe 版（会費を参照する画面用）。
 *
 * 既定会費が読めないこと（rules 未設定・ネットワーク断など）を理由に会計画面が
 * 開けなくなるのを防ぐため、エラーは warn に落として {} を返す。
 */
export async function fetchDefaultFeesSafe(): Promise<Record<string, FeePair>> {
  try {
    const defaultFees = await getDefaultFees();
    return defaultFees?.fees ?? {};
  } catch (error) {
    console.warn('[AppConfig] Failed to fetch default fees:', error);
    return {};
  }
}
