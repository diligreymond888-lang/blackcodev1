import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, KeyRound } from 'lucide-react';

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

const MAX_KEY_LENGTH = 100;

const KeyInput = ({ onValidKey }: KeyInputProps) => {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keyInfo, setKeyInfo] = useState<{ status: string; duration: string } | null>(null);

  const calculateDuration = (expiresAt: string | null, isLifetime: boolean): string => {
    if (isLifetime) return 'Lifetime';
    if (!expiresAt) return 'Unknown';

    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Expired';

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffDays > 0) return `${diffDays}d ${diffHours}h remaining`;
    else if (diffHours > 0) return `${diffHours}h ${diffMinutes}m remaining`;
    else return `${diffMinutes}m remaining`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = key.trim();
    
    if (!trimmedKey) {
      toast.error('Please enter a key');
      return;
    }

    if (trimmedKey.length > MAX_KEY_LENGTH) {
      toast.error('Key is too long');
      return;
    }

    // Sanitize: only allow alphanumeric, dashes, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedKey)) {
      toast.error('Invalid key format');
      return;
    }

    setIsLoading(true);
    setKeyInfo(null);

    try {
      type ValidationResult = { valid: boolean; reason?: string; id?: string; is_lifetime?: boolean; expires_at?: string };
      type UseResult = { success: boolean; key_value?: string; is_lifetime?: boolean; expires_at?: string };

      const { data: validationData, error: validationError } = await supabase
        .rpc('validate_access_key', { p_key_value: trimmedKey });

      const validationResult = validationData as ValidationResult | null;

      if (validationError) {
        console.error('Error validating key:', validationError);
        toast.error('Error validating key');
        return;
      }

      if (!validationResult?.valid) {
        const reason = validationResult?.reason || 'invalid';
        const messages: Record<string, { toast: string; status: string }> = {
          used: { toast: 'This key has already been used', status: 'Used' },
          expired: { toast: 'This key has expired', status: 'Expired' },
          inactive: { toast: 'This key is inactive', status: 'Inactive' },
        };
        const msg = messages[reason] || { toast: 'Invalid key', status: 'Invalid' };
        toast.error(msg.toast);
        setKeyInfo({ status: msg.status, duration: reason === 'expired' ? 'Expired' : 'N/A' });
        return;
      }

      const { data: useData, error: useError } = await supabase
        .rpc('use_access_key', { p_key_id: validationResult.id });

      const useResult = useData as UseResult | null;

      if (useError || !useResult?.success) {
        console.error('Error marking key as used:', useError);
        toast.error('Error activating key');
        return;
      }

      const duration = calculateDuration(useResult.expires_at || null, useResult.is_lifetime || false);
      const info: KeyInfo = { 
        status: 'Valid', 
        duration,
        expiresAt: useResult.expires_at || null,
        isLifetime: useResult.is_lifetime || false,
        keyValue: useResult.key_value || ''
      };
      setKeyInfo({ status: 'Valid', duration });
      toast.success('Key activated successfully!');
      
      setTimeout(() => onValidKey(info), 1500);
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
          <div className="flex-1 relative">
            <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.slice(0, MAX_KEY_LENGTH))}
              placeholder="Enter your key"
              disabled={isLoading}
              maxLength={MAX_KEY_LENGTH}
              autoComplete="off"
              spellCheck="false"
              className="w-full pl-10 pr-4 py-3 glass-panel border border-primary/20 rounded-xl 
                         text-foreground placeholder:text-muted-foreground/40 font-mono text-sm
                         focus:outline-none focus:border-primary/50 focus:shadow-glow-sm
                         transition-all duration-300
                         disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="neon-button px-8 py-3 rounded-xl font-display font-semibold 
                       text-foreground uppercase tracking-wider text-sm
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating
              </>
            ) : 'Submit'}
          </button>
        </div>
      </form>

      {keyInfo && (
        <div className="flex items-center justify-center gap-4 text-sm animate-fade-in">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              keyInfo.status === 'Valid' ? 'bg-success shadow-[0_0_6px_hsl(142_76%_46%/0.5)]' : 
              keyInfo.status === 'Expired' ? 'bg-warning' : 'bg-destructive'
            }`} />
            <span className={`font-medium ${
              keyInfo.status === 'Valid' ? 'text-success' : 
              keyInfo.status === 'Expired' ? 'text-warning' : 'text-destructive'
            }`}>
              {keyInfo.status}
            </span>
          </div>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground font-mono text-xs">{keyInfo.duration}</span>
        </div>
      )}
    </div>
  );
};

export default KeyInput;
