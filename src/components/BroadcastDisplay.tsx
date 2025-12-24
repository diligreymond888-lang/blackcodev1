import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Bell, Info, X } from 'lucide-react';

interface Broadcast {
  id: string;
  title: string;
  message: string;
  priority: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

const BroadcastDisplay = () => {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    fetchBroadcasts();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('broadcasts-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'broadcasts'
        },
        () => {
          fetchBroadcasts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchBroadcasts = async () => {
    const { data, error } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Filter out expired broadcasts
      const activeBroadcasts = (data as Broadcast[]).filter((bc) => {
        if (!bc.expires_at) return true;
        return new Date(bc.expires_at) > new Date();
      });
      setBroadcasts(activeBroadcasts);
    }
  };

  const dismissBroadcast = (id: string) => {
    setDismissedIds(prev => [...prev, id]);
  };

  const getPriorityStyles = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return {
          container: 'bg-red-500/20 border-red-500/50',
          icon: <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />,
          title: 'text-red-300',
          badge: 'bg-red-500/30 text-red-300'
        };
      case 'high':
        return {
          container: 'bg-orange-500/20 border-orange-500/50',
          icon: <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />,
          title: 'text-orange-300',
          badge: 'bg-orange-500/30 text-orange-300'
        };
      case 'low':
        return {
          container: 'bg-blue-500/10 border-blue-500/30',
          icon: <Info className="w-5 h-5 text-blue-400 shrink-0" />,
          title: 'text-blue-300',
          badge: 'bg-blue-500/30 text-blue-300'
        };
      default:
        return {
          container: 'bg-primary/10 border-primary/30',
          icon: <Bell className="w-5 h-5 text-primary shrink-0" />,
          title: 'text-primary',
          badge: 'bg-primary/30 text-primary'
        };
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const visibleBroadcasts = broadcasts.filter(bc => !dismissedIds.includes(bc.id));

  if (visibleBroadcasts.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3 px-4">
      {visibleBroadcasts.map((broadcast) => {
        const styles = getPriorityStyles(broadcast.priority);
        
        return (
          <div
            key={broadcast.id}
            className={`relative rounded-xl border p-4 backdrop-blur-sm transition-all duration-300 animate-fade-in ${styles.container}`}
          >
            {/* Dismiss button */}
            <button
              onClick={() => dismissBroadcast(broadcast.id)}
              className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex items-start gap-3 pr-6">
              {styles.icon}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className={`font-display font-bold text-sm sm:text-base ${styles.title}`}>
                    {broadcast.title}
                  </h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${styles.badge}`}>
                    {broadcast.priority}
                  </span>
                </div>
                
                <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
                  {broadcast.message}
                </p>
                
                <p className="text-muted-foreground/60 text-[10px] mt-2">
                  {formatDate(broadcast.created_at)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BroadcastDisplay;
