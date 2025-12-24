import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAntiDDoS } from '@/hooks/useAntiDDoS';
import { Shield, AlertTriangle, Clock, Activity, Ban, CheckCircle } from 'lucide-react';

interface AntiDDoSContextType {
  isBlocked: boolean;
  remainingRequests: number;
  checkRateLimit: (endpoint?: string) => Promise<boolean>;
  checkRateLimitLocal: () => boolean;
  getBlockTimeRemaining: () => number;
  clientId: string;
  stats: {
    totalRequests: number;
    blockedRequests: number;
    activeBlocks: number;
  };
}

const AntiDDoSContext = createContext<AntiDDoSContextType | null>(null);

export const useAntiDDoSContext = () => {
  const context = useContext(AntiDDoSContext);
  if (!context) {
    throw new Error('useAntiDDoSContext must be used within AntiDDoSProvider');
  }
  return context;
};

interface AntiDDoSProviderProps {
  children: React.ReactNode;
}

export const AntiDDoSProvider: React.FC<AntiDDoSProviderProps> = ({ children }) => {
  const [blockTimeDisplay, setBlockTimeDisplay] = useState(0);
  
  const {
    isBlocked,
    remainingRequests,
    checkRateLimit,
    checkRateLimitLocal,
    getBlockTimeRemaining,
    clientId,
    stats,
    fetchStats,
  } = useAntiDDoS({
    maxRequests: 50,
    windowMs: 60000,
    blockDurationMs: 300000, // 5 minutes block
  });

  // Update block time display and refresh stats
  useEffect(() => {
    if (isBlocked) {
      const interval = setInterval(() => {
        const remaining = getBlockTimeRemaining();
        setBlockTimeDisplay(remaining);
        if (remaining <= 0) {
          window.location.reload();
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isBlocked, getBlockTimeRemaining]);

  // Refresh stats periodically
  useEffect(() => {
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isBlocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-destructive/50 rounded-2xl p-8 text-center space-y-6">
            <div className="w-20 h-20 mx-auto bg-destructive/20 rounded-full flex items-center justify-center animate-pulse">
              <Ban className="w-10 h-10 text-destructive" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Access Blocked</h1>
              <p className="text-muted-foreground">
                Too many requests detected. Your access has been temporarily restricted.
              </p>
            </div>

            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <Shield className="w-5 h-5" />
                <span className="font-semibold">Anti-DDoS Protection Active</span>
              </div>
              
              <div className="flex items-center justify-center gap-2 text-foreground">
                <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: '3s' }} />
                <span className="text-3xl font-mono font-bold">
                  {formatTime(blockTimeDisplay)}
                </span>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Access will be restored automatically
              </p>
            </div>

            {/* Protection Stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-secondary/30 rounded-lg p-3">
                <Activity className="w-4 h-4 mx-auto mb-1 text-primary" />
                <div className="text-lg font-bold text-foreground">{stats.totalRequests}</div>
                <div className="text-xs text-muted-foreground">Requests/1h</div>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3">
                <Ban className="w-4 h-4 mx-auto mb-1 text-destructive" />
                <div className="text-lg font-bold text-foreground">{stats.blockedRequests}</div>
                <div className="text-xs text-muted-foreground">Blocked</div>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-yellow-500" />
                <div className="text-lg font-bold text-foreground">{stats.activeBlocks}</div>
                <div className="text-xs text-muted-foreground">Active Blocks</div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground/70 space-y-1 pt-2 border-t border-border/50">
              <p className="flex items-center justify-center gap-1">
                <CheckCircle className="w-3 h-3 text-green-500" />
                Database-backed protection
              </p>
              <p>Client ID: {clientId.slice(0, 8)}...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AntiDDoSContext.Provider
      value={{
        isBlocked,
        remainingRequests,
        checkRateLimit,
        checkRateLimitLocal,
        getBlockTimeRemaining,
        clientId,
        stats,
      }}
    >
      {children}
    </AntiDDoSContext.Provider>
  );
};
