import { useState } from 'react';
import { buildPracticeEndTime, formatHHMM, PRACTICE_CLOSED_MS, PRACTICE_LAST_CALL_MS } from '../lib/practiceEndPhase';

interface PracticeEndTimeSettingProps {
  practiceStartTime: number;
  practiceEndTime: number | undefined;
  onSave: (practiceEndTime: number | null) => Promise<unknown>;
}

/**
 * 練習終了時刻の設定（管理者向け・セッション共有）。終了20分前以降は新しい試合を
 * 入れず、15分前で完全終了の案内を出す。自動作成セッションは E-ToMo の終了時刻が
 * 入っているので、延長・短縮や手動作成セッション向けに変更・解除できるようにする。
 * 詳細: docs/plans/2026-09-26-practice-end-time.md
 *
 * 親は `key={practiceEndTime}` で渡し、リモートの変更で下書きを作り直す。
 */
export function PracticeEndTimeSetting({ practiceStartTime, practiceEndTime, onSave }: PracticeEndTimeSettingProps) {
  const [draft, setDraft] = useState(practiceEndTime ? formatHHMM(practiceEndTime) : '');
  const [isSaving, setIsSaving] = useState(false);

  const savedHHMM = practiceEndTime ? formatHHMM(practiceEndTime) : '';
  const parsed = draft ? buildPracticeEndTime(practiceStartTime, draft) : null;
  const canSave = !isSaving && draft !== savedHHMM && (draft === '' || parsed !== null);

  const save = async () => {
    setIsSaving(true);
    try {
      await onSave(draft === '' ? null : parsed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor="practice-end-time" className="text-xs font-semibold text-gray-700 mb-1.5 block">
        練習終了時刻
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground whitespace-nowrap">{formatHHMM(practiceStartTime)} 〜</span>
        <input
          id="practice-end-time"
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 min-w-0 border border-border rounded-lg px-2 py-1.5 text-sm bg-background"
        />
        {draft !== '' && (
          <button
            type="button"
            onClick={() => setDraft('')}
            className="text-xs text-muted-foreground px-2 py-1.5 whitespace-nowrap"
          >
            解除
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 whitespace-nowrap"
        >
          保存
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {parsed
          ? `${formatHHMM(parsed - PRACTICE_LAST_CALL_MS)} 以降は新しい試合を入れず連続モードをOFF、${formatHHMM(parsed - PRACTICE_CLOSED_MS)} で練習終了の案内を出します`
          : '未設定のときは終了前の自動停止を行いません'}
      </p>
    </div>
  );
}
