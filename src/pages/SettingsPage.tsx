import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUndoStore } from '../stores/undoStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useReservationStore } from '../stores/reservationStore';
import { ArrowLeft, Trash2, Settings as SettingsIcon } from 'lucide-react';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, updateConfig, clearSession } = useSessionStore();
  const { clearPlayers } = usePlayerStore();
  const { clearHistory } = useGameStore();
  const { useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores, prioritizeRotation, setPrioritizeRotation } = useSettingsStore();
  const { clearAll: clearUndo } = useUndoStore();
  const { clearRecords } = useAccountingStore();
  const { clearReservations } = useReservationStore();

  if (!session) {
    navigate('/');
    return null;
  }

  const handleTargetScoreChange = (score: number) => {
    updateConfig({ targetScore: score });
  };

  const handleReset = () => {
    clearHistory();
    clearPlayers();
    clearUndo();
    clearRecords();
    clearReservations();
    clearSession();
    navigate('/');
  };

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="icon-btn"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} />
            <h1 className="text-lg font-bold">設定</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* コート設定 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center text-sm">🏸</span>
            コート設定
          </h2>
          <div className="space-y-3">
            <div>
              <label className="label">目標点数</label>
              <div className="flex gap-3">
                {[15, 21].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleTargetScoreChange(score)}
                    className={`select-button ${
                      session.config.targetScore === score
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {session.config.targetScore === score && <span className="mr-1">✓</span>}
                    {score}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">配置モード</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setUseStayDurationPriority(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {useStayDurationPriority && <span className="mr-1">✓</span>}
                  待機時間
                </button>
                <button
                  onClick={() => setUseStayDurationPriority(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!useStayDurationPriority && <span className="mr-1">✓</span>}
                  試合回数
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {useStayDurationPriority
                  ? '滞在時間が長い人を優先'
                  : '試合回数が少ない人を優先'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">勝敗記録</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setRecordScores(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    recordScores
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {recordScores && <span className="mr-1">✓</span>}
                  ON
                </button>
                <button
                  onClick={() => setRecordScores(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !recordScores
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!recordScores && <span className="mr-1">✓</span>}
                  OFF
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {recordScores
                  ? '終了時に勝敗を記録'
                  : '勝敗記録なし'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">配置タイミング</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPrioritizeRotation(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    prioritizeRotation
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {prioritizeRotation && <span className="mr-1">✓</span>}
                  流動優先
                </button>
                <button
                  onClick={() => setPrioritizeRotation(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !prioritizeRotation
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!prioritizeRotation && <span className="mr-1">✓</span>}
                  回数優先
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                {prioritizeRotation
                  ? '待機者が少ない時は他コート終了を待って一括配置'
                  : '空きが出たら即座に配置'}
              </p>
            </div>
          </div>
        </div>

        {/* アクション */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <button
              onClick={handleReset}
              className="btn-danger flex items-center justify-center gap-2 py-3 px-6"
            >
              <Trash2 size={18} />
              リセット
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
