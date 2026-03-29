import { RefreshCw, AlertTriangle } from 'lucide-react';

interface RetryIndicatorProps {
  currentRetry: number;
  maxRetries: number;
  isRetrying: boolean;
  accountIndex: number;
  totalAccounts: number;
}

const RetryIndicator = ({ currentRetry, maxRetries, isRetrying, accountIndex, totalAccounts }: RetryIndicatorProps) => {
  if (!isRetrying && currentRetry === 0) return null;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all duration-300 ${
      isRetrying 
        ? 'bg-warning/10 border-warning/30 retry-pulse' 
        : 'bg-muted/30 border-border/30'
    }`}>
      <div className="flex items-center gap-2">
        {isRetrying ? (
          <RefreshCw className="w-4 h-4 text-warning animate-spin" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-warning" />
        )}
        <span className="text-xs font-medium text-warning">
          {isRetrying ? 'Retrying...' : 'Retry completed'}
        </span>
      </div>
      
      <div className="flex-1 flex items-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: maxRetries }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i < currentRetry
                  ? 'bg-warning shadow-[0_0_6px_hsl(38_92%_50%/0.5)]'
                  : 'bg-muted'
              }`}
            />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {currentRetry}/{maxRetries}
        </span>
      </div>

      <span className="text-[10px] text-muted-foreground font-mono">
        [{accountIndex}/{totalAccounts}]
      </span>
    </div>
  );
};

export default RetryIndicator;
