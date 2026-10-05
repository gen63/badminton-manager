import { useState } from 'react';
import { X } from 'lucide-react';
import { parsePlayerInput } from '../lib/utils';
import { formatHHMM } from '../lib/practiceEndPhase';
import {
  describeLateChange,
  formatStayOffsetTime,
  LATE_CHANGE_EFFECT_TEXT,
  lateChangeEffect,
  restrainOffsetOption,
  lateMinutes,
  parseStayOffsetTime,
  reliefOffsetMin,
  type ActualStayStart,
} from '../lib/stayStart';

/** 遅刻救済のクイックボタン（実際の遅刻幅に掛ける比率） */
const RELIEF_OPTIONS: { label: string; ratio: number }[] = [
  { label: '1/2', ratio: 1 / 2 },
  { label: '1/3', ratio: 1 / 3 },
  { label: '0', ratio: 0 },
];

/** 控えめのクイックボタン（実際の遅刻分に足す分数） */
const RESTRAIN_OPTIONS = [15, 30, 60];

const QUICK_BUTTON_CLASS =
  'px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:hover:bg-muted';

/** 保存時に呼び出し側へ渡す値 */
export interface PlayerEditSaveValues {
  name: string;
  gender?: 'M' | 'F';
  rating?: number;
  /** 管理者のときだけ入る（非管理者は undefined ＝触らない） */
  excludeFromOperator?: boolean;
  /**
   * 到着調整（みなし開始時刻を練習開始からの分数で）。undefined ＝変更なし（非管理者・未編集）、
   * null ＝解除、数値 ＝設定。変更の有無はモーダル側だけで判定する（呼び出し側は比較しない）
   */
  stayStartOffsetMin?: number | null;
}

interface PlayerEditModalProps {
  playerName: string;
  playerGender?: 'M' | 'F';
  /** 「終了操作の担当外」の現在値（管理者が設定。未設定＝担当） */
  playerExcludeFromOperator?: boolean;
  /** 現在の到着調整（練習開始からの分数。未設定は undefined） */
  playerStayStartOffsetMin?: number;
  /** 練習開始日時。分数⇔時刻の変換と遅刻幅の基準。0/未定義なら欄を無効化する */
  practiceStartTime?: number;
  /** 練習終了日時（resolvePracticeEndTime）。控えめボタンで終了以降になるものは無効化する */
  practiceEndTime?: number;
  /** 到着調整を無視した従来の起点（resolveActualStayStart）。受付完了時刻の表示と遅刻幅に使う */
  actualStayStart?: ActualStayStart;
  /** 滞在時間モードが ON か（OFF なら「現在は効かない」注記を出す） */
  useStayDurationPriority?: boolean;
  /** 管理者のみ担当トグル・みなし開始時刻を出す */
  isAdmin?: boolean;
  existingNames: string[];
  onSave: (values: PlayerEditSaveValues) => void;
  onCancel: () => void;
}

export function PlayerEditModal({
  playerName,
  playerGender,
  playerExcludeFromOperator,
  playerStayStartOffsetMin,
  practiceStartTime = 0,
  practiceEndTime,
  actualStayStart = { status: 'notArrived' },
  useStayDurationPriority = false,
  isAdmin = false,
  existingNames,
  onSave,
  onCancel,
}: PlayerEditModalProps) {
  const [name, setName] = useState(playerName);
  const [gender, setGender] = useState<'M' | 'F' | undefined>(playerGender);
  // 画面上は肯定形（ON＝担当）。保存時に excludeFromOperator（OFF→true）へ反転する
  const [isOperator, setIsOperator] = useState(playerExcludeFromOperator !== true);
  // 練習開始時刻が無い古いセッションでは到着調整は効かない（resolveStayStart も無視する）ので欄を無効化
  const hasPracticeStart = practiceStartTime > 0;
  // みなし開始時刻（HH:MM）。空文字＝未設定。表示は練習開始＋分数
  const initialOverrideTime = formatStayOffsetTime(playerStayStartOffsetMin, practiceStartTime);
  const [overrideTime, setOverrideTime] = useState(initialOverrideTime);
  const [error, setError] = useState('');

  // 遅刻幅の推移（入力中にリアルタイム更新）。受付完了時刻が分かる人だけ「現状」を出す
  const actualLate =
    hasPracticeStart && actualStayStart.status === 'known'
      ? lateMinutes(actualStayStart.start, practiceStartTime)
      : null;
  const overrideLate = overrideTime === '' ? null : parseStayOffsetTime(overrideTime, practiceStartTime);
  const lateText = hasPracticeStart ? describeLateChange(actualLate, overrideLate) : '';
  // 救済ボタンは受付完了時刻が分かり、実際に遅刻している人だけ
  const showRelief = actualLate !== null && actualLate > 0;
  // 控えめボタンは受付完了時刻が分かる人なら遅刻の有無にかかわらず出す
  const showRestrain = actualLate !== null;
  const effect = lateChangeEffect(actualLate, overrideLate);
  const pickOffset = (offsetMin: number) => {
    setOverrideTime(formatStayOffsetTime(offsetMin, practiceStartTime));
    setError('');
  };
  const arrivalText =
    actualStayStart.status === 'notArrived'
      ? '未到着'
      : actualStayStart.status === 'unknown'
        ? '受付完了 不明'
        : `受付完了 ${formatHHMM(actualStayStart.start)}`;

  const handleSave = () => {
    const parsed = parsePlayerInput(name);
    if (!parsed) {
      setError('名前を入力してください');
      return;
    }
    const { name: parsedName, rating, gender: parsedGender } = parsed;
    if (parsedName !== playerName && existingNames.includes(parsedName)) {
      setError('同じ名前の参加者が既に存在します');
      return;
    }
    const values: PlayerEditSaveValues = { name: parsedName, gender: parsedGender ?? gender, rating };
    if (isAdmin) {
      values.excludeFromOperator = !isOperator;
      // 変更の有無はここだけで判定する（表示上の時刻が変わっていなければ undefined＝触らない）
      if (hasPracticeStart && overrideTime !== initialOverrideTime) {
        if (overrideTime === '') {
          values.stayStartOffsetMin = null;
        } else {
          const offset = parseStayOffsetTime(overrideTime, practiceStartTime);
          if (offset === null) {
            setError('みなし開始時刻の形式が正しくありません');
            return;
          }
          values.stayStartOffsetMin = offset;
        }
      }
    }
    onSave(values);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="card p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">参加者を編集</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-muted rounded-full transition-colors"
            aria-label="閉じる"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 名前入力 */}
          <div>
            <label className="label">名前</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className="input-field w-full"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>

          {/* 性別選択 */}
          <div>
            <label className="label">性別</label>
            <div className="flex gap-2">
              <button
                onClick={() => setGender('M')}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === 'M'
                    ? 'bg-blue-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                男
              </button>
              <button
                onClick={() => setGender('F')}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === 'F'
                    ? 'bg-pink-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                女
              </button>
              <button
                onClick={() => setGender(undefined)}
                className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                  gender === undefined
                    ? 'bg-gray-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                未設定
              </button>
            </div>
          </div>

          {/* 終了操作の担当（管理者のみ）。ON＝担当になる、OFF＝担当外 */}
          {isAdmin && (
            <div>
              <label className="label">終了操作の担当</label>
              <button
                type="button"
                role="switch"
                aria-checked={isOperator}
                onClick={() => setIsOperator((v) => !v)}
                className={`w-full py-2 px-3 rounded-lg font-medium transition-colors ${
                  isOperator
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                終了操作担当{isOperator ? '：ON' : '：OFF'}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                OFFにすると次の試合に入る予測でも終了操作の担当になりません（外部の方・端末不調の方など）
              </p>
            </div>
          )}

          {/* みなし開始時刻（管理者のみ）。滞在時間モードの公平計算の起点を上書きする */}
          {isAdmin && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="stay-start-override">みなし開始時刻</label>
                <span className="text-xs text-muted-foreground tabular-nums" title="会費・名簿が両方完了した時刻">
                  {arrivalText}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  id="stay-start-override"
                  type="time"
                  value={overrideTime}
                  onChange={(e) => { setOverrideTime(e.target.value); setError(''); }}
                  disabled={!hasPracticeStart}
                  className="input-field flex-1 min-w-0 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => { setOverrideTime(''); setError(''); }}
                  disabled={!hasPracticeStart || overrideTime === ''}
                  className="btn-secondary px-4 disabled:opacity-50"
                >
                  解除
                </button>
              </div>
              {lateText && (
                <p className="text-xs text-foreground mt-1 tabular-nums">
                  {lateText}
                  {actualStayStart.status === 'notArrived' && (
                    <span className="text-muted-foreground">（到着（会費・名簿完了）後に有効）</span>
                  )}
                </p>
              )}
              {effect && (
                <p className={`text-xs mt-0.5 ${effect === 'easier' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {LATE_CHANGE_EFFECT_TEXT[effect]}
                </p>
              )}
              {showRelief && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">救済（遅刻幅を縮める）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {RELIEF_OPTIONS.map(({ label, ratio }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => pickOffset(reliefOffsetMin(actualLate, ratio))}
                        className={QUICK_BUTTON_CLASS}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showRestrain && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">控えめ（遅れて来たとみなす）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {RESTRAIN_OPTIONS.map((addMin) => {
                      const { offsetMin, disabled } = restrainOffsetOption(
                        actualLate,
                        addMin,
                        practiceStartTime,
                        practiceEndTime,
                      );
                      return (
                        <button
                          key={addMin}
                          type="button"
                          disabled={disabled}
                          title={disabled ? '練習終了時刻を超えるため選べません' : undefined}
                          onClick={() => pickOffset(offsetMin)}
                          className={QUICK_BUTTON_CLASS}
                        >
                          +{addMin}分
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                遅刻連絡のあった人は早めに（救済）、体調不良などで控えめにしたい人は遅めに設定します。滞在時間モードの公平計算にだけ使います。
              </p>
              {!hasPracticeStart && (
                <p className="text-xs text-muted-foreground mt-1">
                  ※練習開始時刻が未設定のため使えません
                </p>
              )}
              {hasPracticeStart && !useStayDurationPriority && (
                <p className="text-xs text-muted-foreground mt-1">
                  ※現在は回数平均モードのため効きません（滞在時間モードで有効）
                </p>
              )}
            </div>
          )}

          {/* エラーメッセージ */}
          <div className="min-h-[20px]">
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="btn-primary flex-1"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
