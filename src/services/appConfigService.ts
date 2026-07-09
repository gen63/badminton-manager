/**
 * アプリ全体のグローバル設定サービス
 *
 * セッションに紐付かない設定を Firestore の `appConfig/global` document に
 * 保存する。現状はデフォルト周知事項のみ。
 *
 * 注意: Firestore Security Rules（Firebase console 管理）に `appConfig` への
 * read/write 許可が必要。詳細: docs/plans/2026-07-09-default-announcement.md
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { requireDb } from '../lib/firestoreUtils';

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
