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
  showReliefOptions,
  lateMinutes,
  parseStayOffsetTime,
  applyLateRelief,
  buildArrivalAdjustmentUpdate,
  RELIEF_RATIOS,
  reliefReservationNote,
  type ActualStayStart,
} from '../lib/stayStart';
import type { ArrivalAdjustment } from '../types/player';

/** 控えめのクイックボタン（実際の遅刻分に足す分数） */
const RESTRAIN_OPTIONS = [15, 30, 60];

// クイックボタン。DESIGN.md「選択状態」に合わせ、非選択は secondary、選択中は primary＋影＋リング＋拡大
const QUICK_BUTTON_BASE = 'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all';
const QUICK_BUTTON_CLASS = `${QUICK_BUTTON_BASE} bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50`;
const QUICK_BUTTON_SELECTED_CLASS = `${QUICK_BUTTON_BASE} bg-primary text-primary-foreground shadow-lg ring-2 ring-primary/30 scale-105`;

const sameRatio = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

/** 保存時に呼び出し側へ渡す値 */
export interface PlayerEditSaveValues {
  name: string;
  gender?: 'M' | 'F';
  rating?: number;
  /** 管理者のときだけ入る（非管理者は undefined ＝触らない） */
  excludeFromOperator?: boolean;
  /**
   * 到着調整。undefined ＝変更なし（非管理者・未編集）、null ＝解除、値 ＝設定。
   * 変更の有無はモーダル側だけで判定する（呼び出し側は比較しない）
   */
  arrivalAdjustment?: ArrivalAdjustment | null;
}

interface PlayerEditModalProps {
  playerName: string;
  playerGender?: 'M' | 'F';
  /** 「終了操作の担当外」の現在値（管理者が設定。未設定＝担当） */
  playerExcludeFromOperator?: boolean;
  /** 現在の到着調整（未設定は undefined） */
  playerArrivalAdjustment?: ArrivalAdjustment;
  /** 練習開始日時。分数⇔時刻の変換と遅刻幅の基準。0/未定義なら欄を無効化する */
  practiceStartTime?: number;
  /** 練習終了日時（resolvePracticeEndTime）。控えめボタンで終了以降になるものは無効化する */
  practiceEndTime?: number;
  /** 到着調整を無視した従来の起点（resolveActualStayStart）。受付完了時刻の表示と遅刻幅に使う */
  actualStayStart?: ActualStayStart;
  /** 滞在時間モードが ON か（OFF なら「現在は効かない」注記を出す） */
  useStayDurationPriority?: boolean;
  /** 管理者のみ担当トグル・到着調整を出す */
  isAdmin?: boolean;
  existingNames: string[];
  onSave: (values: PlayerEditSaveValues) => void;
  onCancel: () => void;
}

export function PlayerEditModal({
  playerName,
  playerGender,
  playerExcludeFromOperator,
  playerArrivalAdjustment,
  practiceStartTime = 0,
  practiceEndTime,
  actualStayStart = { status: 'opsIncomplete' },
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
  // 到着調整は「時刻（offset、HH:MM）」か「救済の倍率（ratio）」のどちらか一方。
  // overrideTime は時刻方式の入力値（空文字＝なし）。倍率を選んでいる間は空にしておく
  const initialOverrideTime =
    playerArrivalAdjustment?.kind === 'offset'
      ? formatStayOffsetTime(playerArrivalAdjustment.min, practiceStartTime)
      : '';
  const initialRatio = playerArrivalAdjustment?.kind === 'ratio' ? playerArrivalAdjustment.ratio : null;
  const [overrideTime, setOverrideTime] = useState(initialOverrideTime);
  const [ratio, setRatio] = useState<number | null>(initialRatio);
  const [error, setError] = useState('');

  // 受付未完了（会費・名簿のどちらか未完了）。来て試合に出ている人も含む
  const opsIncomplete = actualStayStart.status === 'opsIncomplete';
  // 遅刻幅の推移（入力中にリアルタイム更新）。受付完了時刻が分かる人だけ「現状」を出す
  const actualLate =
    hasPracticeStart && actualStayStart.status === 'known'
      ? lateMinutes(actualStayStart.start, practiceStartTime)
      : null;
  // 受付完了時刻が分かる人が倍率を選んでいれば、その結果の起点（時刻欄には表示だけする）
  const ratioStart =
    hasPracticeStart && ratio !== null && actualStayStart.status === 'known'
      ? applyLateRelief(actualStayStart.start, practiceStartTime, ratio)
      : null;
  const displayTime = ratioStart !== null ? formatHHMM(ratioStart) : overrideTime;
  const adjustedLate =
    ratioStart !== null
      ? lateMinutes(ratioStart, practiceStartTime)
      : overrideTime === ''
        ? null
        : parseStayOffsetTime(overrideTime, practiceStartTime);
  const lateText = hasPracticeStart
    ? describeLateChange(actualLate, adjustedLate, ratioStart !== null && ratio !== null ? ratio : undefined)
    : '';
  // 救済ボタン: 受付未完了は常に、不明は出さない、known は倍率設定済みか遅刻が猶予（10分）超の人だけ
  const showRelief = hasPracticeStart && showReliefOptions(actualStayStart.status, actualLate, ratio !== null);
  // 控えめボタンは受付完了時刻が分かる人なら遅刻の有無にかかわらず出す（受付未完了・不明は実際の遅刻が分からない）
  const showRestrain = actualLate !== null;
  const effect = lateChangeEffect(actualLate, adjustedLate);
  const pickOffset = (offsetMin: number) => {
    setRatio(null);
    setOverrideTime(formatStayOffsetTime(offsetMin, practiceStartTime));
    setError('');
  };
  const toggleRatio = (r: number) => {
    setRatio((cur) => (sameRatio(cur, r) ? null : r));
    setOverrideTime('');
    setError('');
  };
  const arrivalText =
    actualStayStart.status === 'opsIncomplete'
      ? '受付未完了'
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
      // 変更の有無はここだけで判定する（変わっていなければ undefined＝触らない）
      if (hasPracticeStart) {
        const arrivalAdjustment = buildArrivalAdjustmentUpdate(
          { ratio: initialRatio, offsetText: initialOverrideTime },
          { ratio, offsetText: overrideTime },
          (t) => parseStayOffsetTime(t, practiceStartTime),
        );
        if (arrivalAdjustment === 'invalid') {
          setError('到着調整の時刻の形式が正しくありません');
          return;
        }
        if (arrivalAdjustment !== undefined) values.arrivalAdjustment = arrivalAdjustment;
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

          {/* 到着調整（管理者のみ。旧称: みなし開始時刻）。滞在時間モードの公平計算の起点を上書きする */}
          {isAdmin && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="stay-start-override">到着調整</label>
                <span className="text-xs text-muted-foreground tabular-nums" title="会費・名簿が両方完了した時刻">
                  {arrivalText}
                </span>
              </div>
              {/* 時刻欄は全員に出す（offset は練習開始が基準なので、受付未完了でも設定できる） */}
              <div className="flex gap-2">
                <input
                  id="stay-start-override"
                  type="time"
                  value={displayTime}
                  onChange={(e) => { setRatio(null); setOverrideTime(e.target.value); setError(''); }}
                  disabled={!hasPracticeStart}
                  className="input-field flex-1 min-w-0 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => { setRatio(null); setOverrideTime(''); setError(''); }}
                  disabled={!hasPracticeStart || (overrideTime === '' && ratio === null)}
                  className="btn-secondary px-4 disabled:opacity-50"
                >
                  解除
                </button>
              </div>
              {lateText && (
                <p className="text-xs text-foreground mt-1 tabular-nums">
                  {lateText}
                  {opsIncomplete && overrideTime !== '' && (
                    <span className="text-muted-foreground">（受付完了後に有効）</span>
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
                  <p className="text-xs text-muted-foreground mb-1">
                    {opsIncomplete ? '遅刻連絡あり（受付完了時に適用）' : '救済（遅刻幅を縮める）'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {RELIEF_RATIOS.map(({ label, ratio: r }) => {
                      const selected = sameRatio(ratio, r);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleRatio(r)}
                          className={selected ? QUICK_BUTTON_SELECTED_CLASS : QUICK_BUTTON_CLASS}
                        >
                          {selected ? `✓ ${label}` : label}
                        </button>
                      );
                    })}
                  </div>
                  {opsIncomplete && ratio !== null && (
                    <p className="text-xs text-primary mt-1">{reliefReservationNote(ratio)}</p>
                  )}
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
                遅刻連絡のあった人は早めに（救済。受付前でも倍率を予約できます）、体調不良などで控えめにしたい人は遅めに設定します。滞在時間モードの公平計算にだけ使います。
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
