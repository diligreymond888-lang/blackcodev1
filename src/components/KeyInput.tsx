import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface KeyInputProps {
  onValidKey: () => void;
}

interface KeyInfo {
  status: string;
  duration: string;
}

const KeyInput = ({ onValidKey }: KeyInputProps) => {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);

  const calculateDuration = (expiresAt: string | null, isLifetime: boolean): string => {
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

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours}h remaining`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m remaining`;
    } else {
      return `${diffMinutes}m remaining`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      toast.error('Please enter a key');
      return;
    }

    setIsLoading(true);
    setKeyInfo(null);

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
        setKeyInfo({ status: 'Invalid', duration: 'N/A' });
        return;
      }

      // Check if key is expired (unless it's lifetime)
      if (!data.is_lifetime && data.expires_at) {
        const expiresAt = new Date(data.expires_at);
        if (expiresAt < new Date()) {
          toast.error('This key has expired');
          setKeyInfo({ status: 'Expired', duration: 'Expired' });
          return;
        }
      }

      // Key is valid!
      const duration = calculateDuration(data.expires_at, data.is_lifetime);
      setKeyInfo({ status: 'Valid', duration });
      toast.success('Key validated successfully!');
      
      // Small delay to show the status before transitioning
      setTimeout(() => {
        onValidKey();
      }, 1500);
    } catch (err) {
      console.error('Error:', err);
      toast.error('Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <form onSubmit={handleSubmit}>
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

      {keyInfo && (
        <div className="neon-border rounded-lg p-4 bg-card/50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Status</p>
              <p className={`font-display font-bold text-lg ${
                keyInfo.status === 'Valid' ? 'text-green-500' : 
                keyInfo.status === 'Expired' ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {keyInfo.status}
              </p>
            </div>
            <div className="text-center">
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Duration</p>
              <p className="font-display font-bold text-lg text-foreground">
                {keyInfo.duration}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyInput;
