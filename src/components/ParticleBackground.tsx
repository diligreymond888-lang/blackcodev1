import { useEffect, useState } from 'react';

interface Particle {
  id: number;
  top: number;
  left: number;
  duration: number;
  delay: number;
}

const ParticleBackground = () => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const generatedParticles: Particle[] = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      top: Math.random() * 100,
      left: Math.random() * 100,
      duration: 4 + Math.random() * 4,
      delay: Math.random() * 3,
    }));
    setParticles(generatedParticles);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="particle"
          style={{
            top: `${particle.top}%`,
            left: `${particle.left}%`,
            animationDuration: `${particle.duration}s`,
            animationDelay: `${particle.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

export default ParticleBackground;
