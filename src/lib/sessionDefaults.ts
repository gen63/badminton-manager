import type { SyncSettings } from '../services/sessionService';

/**
 * 新規セッション作成時に焼き込む初期設定（練習種別によらず共通）。
 * 男女比調整 OFF / 配置モード=試合回数 / 予約の試合数制限 +1。
 * 旧セッション（未設定）の互換フォールバックは変えないので、ここで明示的に書く。
 */
export const NEW_SESSION_DEFAULTS = {
  genderBalanceMode: false,
  reservationBlockThreshold: 1,
  useStayDurationPriority: false,
} as const satisfies Pick<
  SyncSettings,
  'genderBalanceMode' | 'reservationBlockThreshold' | 'useStayDurationPriority'
>;
