import { Shield, Loader2 } from 'lucide-react';

interface ProgressHeaderProps {
  isRunning: boolean;
  currentIndex: number;
  totalItems: number;
  remainingRequests: number;
}

const ProgressHeader = ({ isRunning, currentIndex, totalItems, remainingRequests }: ProgressHeaderProps) => {
  const progress = totalItems > 0 ? (currentIndex / totalItems) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Protection Status */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-panel border border-success/20">
          <Shield className="w-3 h-3 text-success" />
          <span className="text-[11px] text-success font-medium">Protected</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-panel">
          <span className="text-[11px] text-muted-foreground font-mono">{remainingRequests} req left</span>
        </div>
      </div>

      {/* Progress Bar */}
      {isRunning && totalItems > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-[10px] text-muted-foreground px-1">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              Processing {currentIndex}/{totalItems}
            </span>
            <span className="font-mono">{Math.round(progress)}%</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div 
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out progress-glow"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProgressHeader;
