import { useState, useEffect } from 'react';
import { Cookie, Shield, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CookieStatus {
  total: number;
  banned: number;
  available: number;
  currentIndex: number;
}

const CookieStatusIndicator = () => {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('codm-checker', {
        body: { action: 'cookie_status' }
      });
      if (!error && data) {
        setStatus(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !status) return null;

  const healthPercent = Math.round((status.available / status.total) * 100);
  const isHealthy = healthPercent > 70;
  const isWarning = healthPercent > 30 && healthPercent <= 70;
  const isCritical = healthPercent <= 30;

  return (
    <div className="neon-border rounded-xl glass-panel px-3 py-2.5 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        isHealthy ? 'bg-green-500/10' : isWarning ? 'bg-yellow-500/10' : 'bg-red-500/10'
      }`}>
        {isCritical ? (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        ) : (
          <Cookie className={`w-4 h-4 ${isHealthy ? 'text-green-400' : 'text-yellow-400'}`} />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Cookie Pool</span>
          <span className={`text-[10px] font-mono font-bold ${
            isHealthy ? 'text-green-400' : isWarning ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {healthPercent}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              isHealthy ? 'bg-green-500' : isWarning ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${healthPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-muted-foreground/70 font-mono">
            {status.available}/{status.total} available
          </span>
          {status.banned > 0 && (
            <span className="text-[9px] text-red-400/70 font-mono flex items-center gap-0.5">
              <Shield className="w-2.5 h-2.5" />
              {status.banned} banned
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CookieStatusIndicator;
