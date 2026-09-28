import type { SyncSettings } from '../services/sessionService';
import { DEFAULT_RESERVATION_BLOCK_THRESHOLD } from './algorithm';

/**
 * 新規セッション作成時に焼き込む初期設定（練習種別によらず共通）。
 * 男女比調整 OFF / 配置モード=試合回数 / 予約の試合数制限 +3。
 * 旧セッション（未設定）の互換フォールバックは変えないので、ここで明示的に書く。
 */
export const NEW_SESSION_DEFAULTS = {
  genderBalanceMode: false,
  reservationBlockThreshold: DEFAULT_RESERVATION_BLOCK_THRESHOLD + 1,
  useStayDurationPriority: false,
} as const satisfies Pick<
  SyncSettings,
  'genderBalanceMode' | 'reservationBlockThreshold' | 'useStayDurationPriority'
>;
