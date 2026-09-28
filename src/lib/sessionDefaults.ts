import type { SyncSettings } from '../services/sessionService';
import { DEFAULT_RESERVATION_BLOCK_THRESHOLD } from './algorithm';

/**
 * 新規セッション作成時に練習種別ごとに焼き込む初期設定。
 *
 * 複（ダブルス練習）は 男女比調整 OFF / 配置モード=試合回数 / 予約の試合数制限 +3。
 * 単・楽は従来どおり（受信側の `??` フォールバックと同じ値）を明示する。
 * 旧セッション（未設定）の互換フォールバックは変えないので、ここで明示的に書く。
 */
export function getPracticeTypeDefaults(
  practiceType: '単' | '複' | '楽',
): Pick<SyncSettings, 'genderBalanceMode' | 'reservationBlockThreshold' | 'useStayDurationPriority'> {
  if (practiceType === '複') {
    return {
      genderBalanceMode: false,
      reservationBlockThreshold: DEFAULT_RESERVATION_BLOCK_THRESHOLD + 1,
      useStayDurationPriority: false,
    };
  }
  return {
    genderBalanceMode: true,
    reservationBlockThreshold: DEFAULT_RESERVATION_BLOCK_THRESHOLD,
    useStayDurationPriority: true,
  };
}
