export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-5 w-5 border-2',
    md: 'h-8 w-8 border-[3px]',
    lg: 'h-12 w-12 border-4',
  };

  return (
    <div className="flex items-center justify-center" role="status" aria-label="読み込み中">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-gray-200 border-t-blue-500`}
      />
    </div>
  );
}
