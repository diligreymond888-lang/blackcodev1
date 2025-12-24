import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAntiDDoS, generateFingerprint } from '@/hooks/useAntiDDoS';
import { Shield, AlertTriangle, Clock } from 'lucide-react';

interface AntiDDoSContextType {
  isBlocked: boolean;
  remainingRequests: number;
  checkRateLimit: () => boolean;
  getBlockTimeRemaining: () => number;
  clientId: string;
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
  const [clientId] = useState(() => generateFingerprint());
  const [blockTimeDisplay, setBlockTimeDisplay] = useState(0);
  
  const {
    isBlocked,
    remainingRequests,
    checkRateLimit,
    getBlockTimeRemaining,
  } = useAntiDDoS({
    maxRequests: 50,
    windowMs: 60000,
    blockDurationMs: 180000, // 3 minutes block
  });

  // Update block time display
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

  // Format time display
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
            <div className="w-20 h-20 mx-auto bg-destructive/20 rounded-full flex items-center justify-center">
              <Shield className="w-10 h-10 text-destructive" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Rate Limited</h1>
              <p className="text-muted-foreground">
                Too many requests detected. Please wait before trying again.
              </p>
            </div>

            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-semibold">Anti-DDoS Protection Active</span>
              </div>
              
              <div className="flex items-center justify-center gap-2 text-foreground">
                <Clock className="w-5 h-5" />
                <span className="text-2xl font-mono font-bold">
                  {formatTime(blockTimeDisplay)}
                </span>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Access will be restored automatically
              </p>
            </div>

            <div className="text-xs text-muted-foreground/70 space-y-1">
              <p>Client ID: {clientId}</p>
              <p>This protection helps prevent abuse of our services</p>
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
        getBlockTimeRemaining,
        clientId,
      }}
    >
      {children}
    </AntiDDoSContext.Provider>
  );
};
