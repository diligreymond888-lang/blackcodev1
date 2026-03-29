import { useState, useEffect, useCallback } from 'react';
import ParticleBackground from '@/components/ParticleBackground';
import KeyInput, { KeyInfo } from '@/components/KeyInput';
import PricingTable from '@/components/PricingTable';
import ActionButtons from '@/components/ActionButtons';
import CodmChecker from '@/components/CodmChecker';
import BroadcastDisplay from '@/components/BroadcastDisplay';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const STORAGE_KEY = 'codm_checker_session';

interface StoredSession {
  keyValue: string;
  expiresAt: string | null;
  isLifetime: boolean;
  activatedAt: string;
}

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [displayDuration, setDisplayDuration] = useState<string>('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const calculateDuration = useCallback((expiresAt: string | null, isLifetime: boolean): string => {
    if (isLifetime) return 'Lifetime';
    if (!expiresAt) return 'Unknown';

    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Expired';

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const diffSeconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    if (diffDays > 0) return `${diffDays}d ${diffHours}h ${diffMinutes}m`;
    else if (diffHours > 0) return `${diffHours}h ${diffMinutes}m ${diffSeconds}s`;
    else if (diffMinutes > 0) return `${diffMinutes}m ${diffSeconds}s`;
    else return `${diffSeconds}s`;
  }, []);

  const saveSession = useCallback((info: KeyInfo) => {
    const session: StoredSession = {
      keyValue: info.keyValue,
      expiresAt: info.expiresAt,
      isLifetime: info.isLifetime,
      activatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const checkStoredSession = useCallback(async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setIsCheckingSession(false);
        return;
      }

      const session: StoredSession = JSON.parse(stored);
      
      if (!session.isLifetime && session.expiresAt) {
        const expiry = new Date(session.expiresAt);
        if (expiry <= new Date()) {
          clearSession();
          toast.error('Your key has expired. Please enter a new key.');
          setIsCheckingSession(false);
          return;
        }
      }

      const info: KeyInfo = {
        status: 'Valid',
        duration: calculateDuration(session.expiresAt, session.isLifetime),
        expiresAt: session.expiresAt,
        isLifetime: session.isLifetime,
        keyValue: session.keyValue,
      };
      
      setKeyInfo(info);
      setDisplayDuration(info.duration);
      setIsAuthenticated(true);
      toast.success('Session restored!');
    } catch (error) {
      console.error('Error restoring session:', error);
      clearSession();
    } finally {
      setIsCheckingSession(false);
    }
  }, [calculateDuration, clearSession]);

  useEffect(() => {
    checkStoredSession();
  }, [checkStoredSession]);

  const handleValidKey = (info: KeyInfo) => {
    setKeyInfo(info);
    setDisplayDuration(info.duration);
    setIsAuthenticated(true);
    saveSession(info);
  };

  const handleKeyExpired = useCallback(() => {
    toast.error('Your key has expired. Please enter a new key.');
    setIsAuthenticated(false);
    setKeyInfo(null);
    setDisplayDuration('');
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    if (!isAuthenticated || !keyInfo) return;

    if (keyInfo.isLifetime) {
      setDisplayDuration('Lifetime');
      return;
    }

    if (!keyInfo.expiresAt) return;

    const checkExpiry = () => {
      const now = new Date();
      const expiry = new Date(keyInfo.expiresAt!);
      const diffMs = expiry.getTime() - now.getTime();

      if (diffMs <= 0) {
        handleKeyExpired();
        return false;
      }

      setDisplayDuration(calculateDuration(keyInfo.expiresAt, keyInfo.isLifetime));
      return true;
    };

    if (!checkExpiry()) return;

    const interval = setInterval(() => {
      if (!checkExpiry()) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [isAuthenticated, keyInfo, handleKeyExpired, calculateDuration]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <ParticleBackground />
      
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-4xl mx-auto space-y-10">
          {/* Header */}
          <header className="text-center space-y-2">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold glow-text text-foreground tracking-wider">
              {isAuthenticated ? 'CODM CHECKER' : 'Key System'}
            </h1>
            <p className="text-muted-foreground text-xs font-mono tracking-widest">
              powered by <span className="text-foreground/80">@BlackCodeHat</span>
            </p>
          </header>

          {/* Broadcasts */}
          <section className="w-full">
            <BroadcastDisplay />
          </section>

          {isCheckingSession ? (
            <section className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground text-sm font-mono">Checking session...</p>
            </section>
          ) : !isAuthenticated ? (
            <>
              <section><KeyInput onValidKey={handleValidKey} /></section>
              <section><PricingTable /></section>
              <section><ActionButtons /></section>
            </>
          ) : (
            <section>
              <CodmChecker keyInfo={keyInfo ? { status: keyInfo.status, duration: displayDuration } : null} />
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-8 pb-4 text-center">
          <p className="text-muted-foreground/30 text-[10px] font-mono tracking-widest">
            © 2025 KEY SYSTEM — ALL RIGHTS RESERVED
          </p>
        </footer>
      </main>
    </div>
  );
};

export default Index;
