import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useSettingsStore } from '../stores/settingsStore';
import { sendAccountingToSheets } from '../lib/sheetsApi';
import { ArrowLeft, DollarSign, Save, Copy, Upload, Loader2, Trash2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';

export function AccountingPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players } = usePlayerStore();
  const { records, addRecord, deleteRecord } = useAccountingStore();
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
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  if (!session) {
    navigate('/');
    return null;
  }

  // 現在の参加者数
  const participantCount = players.filter(p => p.isPresent).length;

  // 計算
  const maleTotal = maleCount * maleFee;
  const femaleTotal = femaleCount * femaleFee;
  const shuttleTotal = shuttleCount * shuttlePrice;
  const finalTotal = maleTotal + femaleTotal - gymCost - shuttleTotal;

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

  // コピー用テキスト生成
  const generateCopyText = () => {
    const lines = [
      `${formattedDate}${gymShortName}複`,
      `参加${participantCount}`,
      `免除${exemptCount} 男${maleCount} 女${femaleCount}`,
      `男${maleFee}×${maleCount} = ${maleTotal.toLocaleString()}`,
      `女${femaleFee}×${femaleCount} = ${femaleTotal.toLocaleString()}`,
      `免除 ${exemptCount} 0円`,
      `体育館-${gymCost.toLocaleString()}`,
      `シャトル使用数${shuttlePrice}×${shuttleCount} = ${shuttleTotal.toLocaleString()}`,
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('コピーしました');
    } catch (err) {
      console.error('Failed to copy:', err);
      toast.error('コピーに失敗しました');
    }
  };

  const handleSave = () => {
    const record = {
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
    addRecord(record);
    toast.success('保存しました');
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
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteRecord(id);
    toast.success('削除しました');
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
          <div className="flex items-center gap-2 flex-1">
            <DollarSign size={20} />
            <h1 className="text-lg font-bold">会計</h1>
          </div>
          {gasWebAppUrl && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              aria-label="Sheetsにアップロード"
              className="icon-btn disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </button>
          )}
          <button
            onClick={handleCopy}
            aria-label="コピー"
            className="icon-btn"
          >
            <Copy size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* 日付・体育館 */}
        <div className="card p-4 bg-blue-50 border-blue-200">
          <div className="text-2xl font-bold text-center text-gray-800">
            {formattedDate}{gymShortName}複
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
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-1">免除</div>
              <input
                type="number"
                value={exemptCount || ''}
                onChange={(e) => setExemptCount(parseInt(e.target.value) || 0)}
                className="w-full text-xl font-bold text-gray-800 bg-transparent border-none p-0 text-center"
                inputMode="numeric"
              />
            </div>
            <div className="bg-blue-100 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-1">男</div>
              <input
                type="number"
                value={maleCount || ''}
                onChange={(e) => setMaleCount(parseInt(e.target.value) || 0)}
                className="w-full text-xl font-bold text-blue-800 bg-transparent border-none p-0 text-center"
                inputMode="numeric"
              />
            </div>
            <div className="bg-pink-100 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-1">女</div>
              <input
                type="number"
                value={femaleCount || ''}
                onChange={(e) => setFemaleCount(parseInt(e.target.value) || 0)}
                className="w-full text-xl font-bold text-pink-800 bg-transparent border-none p-0 text-center"
                inputMode="numeric"
              />
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
                <span className="text-sm font-semibold">{exemptCount}</span>
              </div>
              <span className="text-lg font-bold text-gray-600">0円</span>
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

        {/* アクション */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6"
          >
            <Save size={18} />
            保存
          </button>
        </div>

        {/* 保存済み履歴 */}
        {records.length > 0 && (
          <div className="card p-4">
            <h2 className="text-sm font-bold mb-3 text-gray-700">保存済み履歴</h2>
            <div className="space-y-2">
              {[...records].reverse().map((record) => (
                <div
                  key={record.id}
                  className="bg-gray-50 rounded-lg p-3 border border-gray-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-gray-800 mb-1">
                        {record.date}{record.gym}複
                      </div>
                      <div className="text-xs text-gray-600 space-y-0.5">
                        <div>参加{record.participantCount} (免除{record.exemptCount} 男{record.maleCount} 女{record.femaleCount})</div>
                        <div>収入: 男{record.maleTotal.toLocaleString()} + 女{record.femaleTotal.toLocaleString()}</div>
                        <div>支出: 体育館{record.gymCost.toLocaleString()} + シャトル{record.shuttleTotal.toLocaleString()}</div>
                      </div>
                      <div className={`text-lg font-bold mt-1 ${record.finalTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {record.finalTotal >= 0 ? '+' : ''}{record.finalTotal.toLocaleString()}円
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(record.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all flex-shrink-0"
                      aria-label="削除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* プレビュー */}
        <div className="card p-4 bg-gray-50">
          <h2 className="text-xs font-bold mb-2 text-gray-600">コピー内容プレビュー</h2>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white p-3 rounded border border-gray-200">
            {generateCopyText()}
          </pre>
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
