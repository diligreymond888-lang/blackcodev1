import { useState } from 'react';
import { toast } from 'sonner';

const KeyInput = () => {
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      toast.error('Please enter a key');
      return;
    }
    toast.success('Key submitted successfully!');
    setKey('');
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter your key"
          className="flex-1 px-4 py-3 bg-secondary/50 border border-primary/30 rounded-lg 
                     text-foreground placeholder:text-muted-foreground
                     focus:outline-none focus:border-primary focus:shadow-glow-md
                     transition-all duration-300 font-sans"
        />
        <button
          type="submit"
          className="neon-button px-8 py-3 rounded-lg font-display font-semibold 
                     text-foreground uppercase tracking-wider
                     hover:scale-105 active:scale-95 transition-transform"
        >
          Submit
        </button>
      </div>
    </form>
  );
};

export default KeyInput;
