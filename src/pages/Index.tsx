import ParticleBackground from '@/components/ParticleBackground';
import KeyInput from '@/components/KeyInput';
import PricingTable from '@/components/PricingTable';
import ActionButtons from '@/components/ActionButtons';

const Index = () => {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <ParticleBackground />
      
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl mx-auto space-y-12">
          {/* Header */}
          <header className="text-center space-y-2">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-display font-bold glow-text text-foreground tracking-wider">
              Key System
            </h1>
            <p className="text-muted-foreground text-sm">
              powered by <span className="text-foreground">@egoistyato</span>
            </p>
          </header>

          {/* Key Input */}
          <section>
            <KeyInput />
          </section>

          {/* Pricing */}
          <section>
            <PricingTable />
          </section>

          {/* Action Buttons */}
          <section>
            <ActionButtons />
          </section>
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
