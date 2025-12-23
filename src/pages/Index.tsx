import { useState } from 'react';
import ParticleBackground from '@/components/ParticleBackground';
import KeyInput, { KeyInfo } from '@/components/KeyInput';
import PricingTable from '@/components/PricingTable';
import ActionButtons from '@/components/ActionButtons';
import CodmChecker from '@/components/CodmChecker';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);

  const handleValidKey = (info: KeyInfo) => {
    setKeyInfo(info);
    setIsAuthenticated(true);
  };

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
              <CodmChecker keyInfo={keyInfo} />
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
