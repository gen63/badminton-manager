interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-base font-semibold text-gray-700 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 min-h-[44px]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
