import { useEffect, useState, useMemo } from 'react';

interface Particle {
  id: number;
  top: number;
  left: number;
  duration: number;
  delay: number;
  size: number;
  opacity: number;
}

const ParticleBackground = () => {
  const [isVisible, setIsVisible] = useState(true);

  // Check for reduced motion preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsVisible(!mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setIsVisible(!e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Memoize particles to prevent re-renders
  const particles = useMemo<Particle[]>(() => 
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      top: Math.random() * 100,
      left: Math.random() * 100,
      duration: 5 + Math.random() * 5,
      delay: Math.random() * 4,
      size: 2 + Math.random() * 3,
      opacity: 0.3 + Math.random() * 0.5,
    })), []);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="particle"
          style={{
            top: `${particle.top}%`,
            left: `${particle.left}%`,
            animationDuration: `${particle.duration}s`,
            animationDelay: `${particle.delay}s`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            opacity: particle.opacity,
          }}
        />
      ))}
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/3 blur-[120px]" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] rounded-full bg-primary/2 blur-[100px]" />
    </div>
  );
};

export default ParticleBackground;
