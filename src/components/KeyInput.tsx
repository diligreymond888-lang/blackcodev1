import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export interface KeyInfo {
  status: string;
  duration: string;
  expiresAt: string | null;
  isLifetime: boolean;
  keyValue: string;
}

interface KeyInputProps {
  onValidKey: (keyInfo: KeyInfo) => void;
}

const KeyInput = ({ onValidKey }: KeyInputProps) => {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keyInfo, setKeyInfo] = useState<{ status: string; duration: string } | null>(null);

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
      // Check if key exists and is valid (not used and active)
      const { data, error } = await supabase
        .from('access_keys')
        .select('*')
        .eq('key_value', key.trim())
        .eq('is_active', true)
        .eq('is_used', false)
        .maybeSingle();

      if (error) {
        console.error('Error validating key:', error);
        toast.error('Error validating key');
        return;
      }

      if (!data) {
        // Check if key exists but is already used
        const { data: usedKey } = await supabase
          .from('access_keys')
          .select('is_used')
          .eq('key_value', key.trim())
          .maybeSingle();

        if (usedKey?.is_used) {
          toast.error('This key has already been used');
          setKeyInfo({ status: 'Used', duration: 'N/A' });
        } else {
          toast.error('Invalid key');
          setKeyInfo({ status: 'Invalid', duration: 'N/A' });
        }
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

      // Mark the key as used
      const { error: updateError } = await supabase
        .from('access_keys')
        .update({ 
          is_used: true, 
          used_at: new Date().toISOString() 
        })
        .eq('id', data.id);

      if (updateError) {
        console.error('Error marking key as used:', updateError);
        toast.error('Error activating key');
        return;
      }

      // Key is valid!
      const duration = calculateDuration(data.expires_at, data.is_lifetime);
      const info: KeyInfo = { 
        status: 'Valid', 
        duration,
        expiresAt: data.expires_at,
        isLifetime: data.is_lifetime,
        keyValue: data.key_value
      };
      setKeyInfo({ status: 'Valid', duration });
      toast.success('Key activated successfully!');
      
      // Small delay to show the status before transitioning
      setTimeout(() => {
        onValidKey(info);
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
        <div className="flex items-center justify-center gap-4 text-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              keyInfo.status === 'Valid' ? 'bg-green-500' : 
              keyInfo.status === 'Expired' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
            <span className={`font-medium ${
              keyInfo.status === 'Valid' ? 'text-green-500' : 
              keyInfo.status === 'Expired' ? 'text-yellow-500' : 'text-red-500'
            }`}>
              {keyInfo.status}
            </span>
          </div>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{keyInfo.duration}</span>
        </div>
      )}
    </div>
  );
};

export default KeyInput;
