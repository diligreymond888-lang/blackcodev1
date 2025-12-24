import { useState, useEffect, useCallback } from 'react';
import ParticleBackground from '@/components/ParticleBackground';
import KeyInput, { KeyInfo } from '@/components/KeyInput';
import PricingTable from '@/components/PricingTable';
import ActionButtons from '@/components/ActionButtons';
import CodmChecker from '@/components/CodmChecker';
import BroadcastDisplay from '@/components/BroadcastDisplay';
import { toast } from 'sonner';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [displayDuration, setDisplayDuration] = useState<string>('');

  const calculateDuration = useCallback((expiresAt: string | null, isLifetime: boolean): string => {
    if (isLifetime) {
      return 'Lifetime';
    }
    
    if (!expiresAt) {
      return 'Unknown';
    }

    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return 'Expired';
    }

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const diffSeconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours}h ${diffMinutes}m`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m ${diffSeconds}s`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ${diffSeconds}s`;
    } else {
      return `${diffSeconds}s`;
    }
  }, []);

  const handleValidKey = (info: KeyInfo) => {
    setKeyInfo(info);
    setDisplayDuration(info.duration);
    setIsAuthenticated(true);
  };

  const handleKeyExpired = useCallback(() => {
    toast.error('Your key has expired. Please enter a new key.');
    setIsAuthenticated(false);
    setKeyInfo(null);
    setDisplayDuration('');
  }, []);

  // Monitor key expiry
  useEffect(() => {
    if (!isAuthenticated || !keyInfo) return;

    // For lifetime keys, no need to check expiry
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

      // Update the display duration
      setDisplayDuration(calculateDuration(keyInfo.expiresAt, keyInfo.isLifetime));
      return true;
    };

    // Check immediately
    if (!checkExpiry()) return;

    // Check every second for live countdown
    const interval = setInterval(() => {
      if (!checkExpiry()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isAuthenticated, keyInfo, handleKeyExpired, calculateDuration]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <ParticleBackground />
      
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-4xl mx-auto space-y-12">
          {/* Header */}
          <header className="text-center space-y-2">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-display font-bold glow-text text-foreground tracking-wider">
              {isAuthenticated ? 'CODM CHECKER' : 'Key System'}
            </h1>
            <p className="text-muted-foreground text-sm">
              powered by <span className="text-foreground">@BlackCodeHat</span>
            </p>
          </header>

          {/* Broadcasts Section */}
          <section className="w-full">
            <BroadcastDisplay />
          </section>

          {!isAuthenticated ? (
            <>
              {/* Key Input */}
              <section>
                <KeyInput onValidKey={handleValidKey} />
              </section>

              {/* Pricing */}
              <section>
                <PricingTable />
              </section>

              {/* Action Buttons */}
              <section>
                <ActionButtons />
              </section>
            </>
          ) : (
            /* CODM Checker Interface */
            <section>
              <CodmChecker keyInfo={keyInfo ? { status: keyInfo.status, duration: displayDuration } : null} />
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="absolute bottom-6 left-0 right-0 text-center">
          <p className="text-muted-foreground text-sm">
            © 2025 Key System — All rights reserved
          </p>
        </footer>
      </main>
    </div>
  );
};

export default Index;
