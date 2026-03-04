import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import { sendAccountingToSheets } from '../lib/sheetsApi';
import { ArrowLeft, DollarSign, Copy, Upload, Loader2 } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';

export function AccountingPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players } = usePlayerStore();
  const { matchHistory } = useGameStore();
  const { records, addRecord } = useAccountingStore();
  const { gasWebAppUrl } = useSettingsStore();
  const toast = useToast();

  // 入力状態
  const [exemptCount, setExemptCount] = useState<number>(0);
  const [maleCount, setMaleCount] = useState<number>(0);
  const [femaleCount, setFemaleCount] = useState<number>(0);
  const [maleFee, setMaleFee] = useState<number>(800);
  const [femaleFee, setFemaleFee] = useState<number>(600);
  const [gymCost, setGymCost] = useState<number>(900);
  const [shuttlePrice, setShuttlePrice] = useState<number>(480);
  const [shuttleCount, setShuttleCount] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  if (!session) {
    navigate('/');
    return null;
  }

  // 日付フォーマット（YYYY/MM/DD）
  const formattedDate = useMemo(() => {
    const date = new Date(session.config.practiceStartTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }, [session.config.practiceStartTime]);

  // 体育館名（略称に変換）
  const gymShortName = useMemo(() => {
    const gym = session.config.gym || '';
    if (gym.includes('目白')) return '目白';
    if (gym.includes('千早')) return '千早';
    if (gym.includes('南長崎')) return '南長崎';
    if (gym.includes('巣鴨')) return '巣鴨';
    return gym;
  }, [session.config.gym]);

  // 試合履歴・過去の会計データから初期値を自動設定
  useEffect(() => {
    if (initialized) return;

    // 体育館別の固定料金設定
    const gymCostMap: Record<string, number> = {
      '目白': 900,
      '千早': 900,
      '南長崎': 900,
      '巣鴨': 900,
    };

    // 過去の会計履歴から直近の料金設定を取得
    if (records.length > 0) {
      const latestRecord = records[records.length - 1];
      setMaleFee(latestRecord.maleFee);
      setFemaleFee(latestRecord.femaleFee);
      setShuttlePrice(latestRecord.shuttlePrice);
      
      // 同じ体育館の直近データがあればその体育館代を使う
      const sameGymRecord = [...records].reverse().find(r => r.gym === gymShortName);
      if (sameGymRecord) {
        setGymCost(sameGymRecord.gymCost);
      } else {
        // なければ体育館別の固定値
        setGymCost(gymCostMap[gymShortName] || 900);
      }
    } else {
      // 過去データがない場合は体育館別の固定値
      setGymCost(gymCostMap[gymShortName] || 900);
    }

    // 試合履歴から参加者・シャトル数を推定
    if (matchHistory.length > 0) {
      // 試合に参加した全プレイヤーIDを抽出
      const participantIds = new Set<string>();
      matchHistory.forEach((match) => {
        match.teamA.forEach((id) => participantIds.add(id));
        match.teamB.forEach((id) => participantIds.add(id));
      });

      // プレイヤー情報から性別を集計
      let maleParticipants = 0;
      let femaleParticipants = 0;
      let unknownGender = 0;

      participantIds.forEach((playerId) => {
        const player = players.find((p) => p.id === playerId);
        if (player?.gender === 'M') {
          maleParticipants++;
        } else if (player?.gender === 'F') {
          femaleParticipants++;
        } else {
          unknownGender++;
        }
      });

      // 性別不明者は男性として扱う（デフォルト）
      maleParticipants += unknownGender;

      // シャトル使用数の推定（1試合あたり約1.5個）
      const estimatedShuttles = Math.ceil(matchHistory.length * 1.5);

      setMaleCount(maleParticipants);
      setFemaleCount(femaleParticipants);
      setShuttleCount(estimatedShuttles);
    }

    setInitialized(true);
  }, [matchHistory, players, records, gymShortName, initialized]);

  // 参加人数の合計（免除+男+女）
  const participantCount = exemptCount + maleCount + femaleCount;

  // 計算
  const maleTotal = maleCount * maleFee;
  const femaleTotal = femaleCount * femaleFee;
  const shuttleTotal = shuttleCount * shuttlePrice;
  const finalTotal = maleTotal + femaleTotal - gymCost - shuttleTotal;

  // コピー用テキスト生成
  const generateCopyText = () => {
    const lines = [
      `${formattedDate} 複`,
      `参加${participantCount}`,
      `免除${exemptCount} 男${maleCount} 女${femaleCount}`,
      `男 ${maleFee}×${maleCount} = ${maleTotal.toLocaleString()}`,
      `女 ${femaleFee}×${femaleCount} = ${femaleTotal.toLocaleString()}`,
      `免除 ${exemptCount}×0 = 0`,
      `体育館-${gymCost.toLocaleString()}`,
      `シャトル使用数 -${shuttlePrice}×${shuttleCount} = -${shuttleTotal.toLocaleString()}`,
      '',
      '合計',
      `${maleTotal.toLocaleString()}+${femaleTotal.toLocaleString()}-${gymCost.toLocaleString()}-${shuttleTotal.toLocaleString()} = ${finalTotal.toLocaleString()}`,
    ];
    return lines.join('\n');
  };

  const handleCopy = async () => {
    const text = generateCopyText();
    try {
      await navigator.clipboard.writeText(text);
      toast.success('コピーしました');
    } catch (err) {
      console.error('Failed to copy:', err);
      toast.error('コピーに失敗しました');
    }
  };

  const handleUpload = async () => {
    if (!gasWebAppUrl || isUploading) return;
    
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      date: formattedDate,
      gym: gymShortName,
      participantCount,
      exemptCount,
      maleCount,
      femaleCount,
      maleFee,
      femaleFee,
      gymCost,
      shuttlePrice,
      shuttleCount,
      maleTotal,
      femaleTotal,
      shuttleTotal,
      finalTotal,
    };

    setIsUploading(true);
    try {
      const result = await sendAccountingToSheets(gasWebAppUrl, record);
      if (result.success) {
        // アップロード成功時にローカルにも保存（次回の自動入力用）
        addRecord({
          date: formattedDate,
          gym: gymShortName,
          participantCount,
          exemptCount,
          maleCount,
          femaleCount,
          maleFee,
          femaleFee,
          gymCost,
          shuttlePrice,
          shuttleCount,
          maleTotal,
          femaleTotal,
          shuttleTotal,
          finalTotal,
        });
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            aria-label="戻る"
            className="icon-btn"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <DollarSign size={20} />
            <h1 className="text-lg font-bold">会計</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* 日付・体育館 */}
        <div className="card p-4 bg-blue-50 border-blue-200">
          <div className="text-2xl font-bold text-center text-gray-800">
            {formattedDate} {gymShortName} 複
          </div>
        </div>

        {/* 参加人数 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">参加人数</h2>
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-1">合計</div>
              <div className="text-2xl font-bold text-blue-600">{participantCount}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-600 mb-1 text-center">免除</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => setExemptCount(Math.max(0, exemptCount - 1))}
                  className="w-6 h-6 rounded-full bg-white text-gray-600 hover:bg-gray-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-gray-800">{exemptCount}</span>
                <button
                  onClick={() => setExemptCount(exemptCount + 1)}
                  className="w-6 h-6 rounded-full bg-white text-gray-600 hover:bg-gray-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-blue-100 rounded-lg p-2">
              <div className="text-xs text-gray-600 mb-1 text-center">男</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => setMaleCount(Math.max(0, maleCount - 1))}
                  className="w-6 h-6 rounded-full bg-white text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-blue-800">{maleCount}</span>
                <button
                  onClick={() => setMaleCount(maleCount + 1)}
                  className="w-6 h-6 rounded-full bg-white text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-pink-100 rounded-lg p-2">
              <div className="text-xs text-gray-600 mb-1 text-center">女</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => setFemaleCount(Math.max(0, femaleCount - 1))}
                  className="w-6 h-6 rounded-full bg-white text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-pink-800">{femaleCount}</span>
                <button
                  onClick={() => setFemaleCount(femaleCount + 1)}
                  className="w-6 h-6 rounded-full bg-white text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 収入 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">収入</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">男</span>
                <input
                  type="number"
                  value={maleFee || ''}
                  onChange={(e) => setMaleFee(parseInt(e.target.value) || 0)}
                  className="w-16 text-sm font-semibold bg-white rounded px-2 py-1 text-right"
                  inputMode="numeric"
                />
                <span className="text-sm text-gray-600">×</span>
                <span className="text-sm font-semibold">{maleCount}</span>
              </div>
              <span className="text-lg font-bold text-blue-600">
                {maleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-pink-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">女</span>
                <input
                  type="number"
                  value={femaleFee || ''}
                  onChange={(e) => setFemaleFee(parseInt(e.target.value) || 0)}
                  className="w-16 text-sm font-semibold bg-white rounded px-2 py-1 text-right"
                  inputMode="numeric"
                />
                <span className="text-sm text-gray-600">×</span>
                <span className="text-sm font-semibold">{femaleCount}</span>
              </div>
              <span className="text-lg font-bold text-pink-600">
                {femaleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">免除</span>
                <span className="text-sm font-semibold">0</span>
                <span className="text-sm text-gray-600">×</span>
                <span className="text-sm font-semibold">{exemptCount}</span>
              </div>
              <span className="text-lg font-bold text-gray-600">0</span>
            </div>
          </div>
        </div>

        {/* 支出 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">支出</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
              <span className="text-sm text-gray-600">体育館</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">-</span>
                <input
                  type="number"
                  value={gymCost || ''}
                  onChange={(e) => setGymCost(parseInt(e.target.value) || 0)}
                  className="w-20 text-sm font-semibold bg-white rounded px-2 py-1 text-right"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">シャトル</span>
                <input
                  type="number"
                  value={shuttlePrice || ''}
                  onChange={(e) => setShuttlePrice(parseInt(e.target.value) || 0)}
                  className="w-16 text-sm font-semibold bg-white rounded px-2 py-1 text-right"
                  inputMode="numeric"
                />
                <span className="text-sm text-gray-600">×</span>
                <input
                  type="number"
                  value={shuttleCount || ''}
                  onChange={(e) => setShuttleCount(parseInt(e.target.value) || 0)}
                  className="w-12 text-sm font-semibold bg-white rounded px-2 py-1 text-right"
                  inputMode="numeric"
                />
              </div>
              <span className="text-lg font-bold text-red-600">
                -{shuttleTotal.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* 合計 */}
        <div className="card p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200">
          <h2 className="text-sm font-bold mb-3 text-gray-700">合計</h2>
          <div className="text-xs text-gray-600 mb-2 font-mono">
            {maleTotal.toLocaleString()}+{femaleTotal.toLocaleString()}-{gymCost.toLocaleString()}-{shuttleTotal.toLocaleString()}
          </div>
          <div className={`text-4xl font-bold text-center ${finalTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {finalTotal >= 0 ? '+' : ''}{finalTotal.toLocaleString()}円
          </div>
        </div>

        {/* プレビュー */}
        <div className="card p-4 bg-gray-50">
          <h2 className="text-xs font-bold mb-2 text-gray-600">コピー内容プレビュー</h2>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white p-3 rounded border border-gray-200">
            {generateCopyText()}
          </pre>
        </div>

        {/* アクションボタン */}
        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6"
          >
            <Copy size={18} />
            コピー
          </button>
          {gasWebAppUrl && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  送信中...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  アップロード
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </div>
  );
}
