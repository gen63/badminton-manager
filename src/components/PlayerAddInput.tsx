import { useState, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { parsePlayerInput } from '../lib/utils';

interface PlayerAddInputProps {
  onAdd: (name: string, gender: 'M' | 'F') => void;
  placeholder?: string;
  className?: string;
}

export function PlayerAddInput({ onAdd, placeholder = 'こば', className = '' }: PlayerAddInputProps) {
  const [name, setName] = useState('');
  const [selectedGender, setSelectedGender] = useState<'M' | 'F' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const hasName = trimmed.length > 0;

  // 性別選択後にinputにフォーカスを戻す
  useEffect(() => {
    if (selectedGender !== null) {
      inputRef.current?.focus();
    }
  }, [selectedGender]);

  const handleConfirm = () => {
    if (!hasName || selectedGender === null) return;

    // 入力テキストから性別が指定されていればそちらを優先
    const parsed = parsePlayerInput(trimmed);
    const finalName = parsed?.name || trimmed;
    const finalGender = parsed?.gender || selectedGender;

    onAdd(finalName, finalGender);
    setName('');
    setSelectedGender(null);
  };

  const handleCancel = () => {
    setSelectedGender(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && hasName && selectedGender !== null) {
      handleConfirm();
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 input-field"
      />
      {selectedGender === null ? (
        <>
          <button
            onClick={() => setSelectedGender('M')}
            disabled={!hasName}
            className="min-w-[44px] h-11 px-3 bg-blue-500 text-white rounded-xl text-sm font-medium
                     hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all duration-150"
          >
            男
          </button>
          <button
            onClick={() => setSelectedGender('F')}
            disabled={!hasName}
            className="min-w-[44px] h-11 px-3 bg-pink-500 text-white rounded-xl text-sm font-medium
                     hover:bg-pink-600 active:bg-pink-700 active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all duration-150"
          >
            女
          </button>
        </>
      ) : (
        <>
          <button
            onClick={handleConfirm}
            className="min-w-[44px] h-11 px-3 bg-primary text-primary-foreground rounded-xl text-sm font-medium
                     hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98]
                     transition-all duration-150 flex items-center justify-center"
          >
            <Check size={18} />
          </button>
          <button
            onClick={handleCancel}
            className="min-w-[44px] h-11 px-3 bg-muted text-muted-foreground rounded-xl text-sm font-medium
                     hover:bg-muted/80 active:scale-[0.98]
                     transition-all duration-150 flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </>
      )}
    </div>
  );
}
