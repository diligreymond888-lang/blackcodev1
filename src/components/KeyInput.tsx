import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface KeyInputProps {
  onValidKey: () => void;
}

const KeyInput = ({ onValidKey }: KeyInputProps) => {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      toast.error('Please enter a key');
      return;
    }

    setIsLoading(true);

    try {
      // Check if key exists and is valid
      const { data, error } = await supabase
        .from('access_keys')
        .select('*')
        .eq('key_value', key.trim())
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error validating key:', error);
        toast.error('Error validating key');
        return;
      }

      if (!data) {
        toast.error('Invalid key');
        return;
      }

      // Check if key is expired (unless it's lifetime)
      if (!data.is_lifetime && data.expires_at) {
        const expiresAt = new Date(data.expires_at);
        if (expiresAt < new Date()) {
          toast.error('This key has expired');
          return;
        }
      }

      // Key is valid!
      toast.success('Key validated successfully!');
      onValidKey();
    } catch (err) {
      console.error('Error:', err);
      toast.error('Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter your key"
          disabled={isLoading}
          className="flex-1 px-4 py-3 bg-secondary/50 border border-primary/30 rounded-lg 
                     text-foreground placeholder:text-muted-foreground
                     focus:outline-none focus:border-primary focus:shadow-glow-md
                     transition-all duration-300 font-sans
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="neon-button px-8 py-3 rounded-lg font-display font-semibold 
                     text-foreground uppercase tracking-wider
                     hover:scale-105 active:scale-95 transition-transform
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Validating...' : 'Submit'}
        </button>
      </div>
    </form>
  );
};

export default KeyInput;
