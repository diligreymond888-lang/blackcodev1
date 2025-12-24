import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  blockDurationMs: number;
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 50,
  windowMs: 60000,
  blockDurationMs: 300000,
};

// Fingerprint generation for tracking
export const generateFingerprint = (): string => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('fingerprint', 2, 2);
  }
  
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    canvas.toDataURL(),
  ].join('|');

  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

export const useAntiDDoS = (config: Partial<RateLimitConfig> = {}) => {
  const finalConfig = { ...defaultConfig, ...config };
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockEndTime, setBlockEndTime] = useState<number | null>(null);
  const [remainingRequests, setRemainingRequests] = useState(finalConfig.maxRequests);
  const [stats, setStats] = useState({
    totalRequests: 0,
    blockedRequests: 0,
    activeBlocks: 0,
  });
  const requestLog = useRef<number[]>([]);
  const clientId = useRef(generateFingerprint());

  // Check server-side protection status
  const checkServerStatus = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke('anti-ddos', {
        body: { action: 'status' },
        headers: { 'x-client-id': clientId.current }
      });

      if (data?.blocked) {
        setIsBlocked(true);
        setBlockEndTime(new Date(data.expires_at).getTime());
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to check server status:', error);
      return true; // Fail open
    }
  }, []);

  // Check rate limit with server
  const checkRateLimitServer = useCallback(async (endpoint: string = 'general'): Promise<boolean> => {
    try {
      const { data } = await supabase.functions.invoke('anti-ddos', {
        body: { action: 'check', endpoint },
        headers: { 'x-client-id': clientId.current }
      });

      if (data?.blocked) {
        setIsBlocked(true);
        setBlockEndTime(new Date(data.expires_at).getTime());
        return false;
      }

      if (data?.remaining !== undefined) {
        setRemainingRequests(data.remaining);
      }

      return data?.allowed !== false;
    } catch (error) {
      console.error('Failed to check rate limit:', error);
      return true; // Fail open
    }
  }, []);

  // Local rate limiting (fast check)
  const cleanOldRequests = useCallback(() => {
    const now = Date.now();
    requestLog.current = requestLog.current.filter(
      (timestamp) => now - timestamp < finalConfig.windowMs
    );
  }, [finalConfig.windowMs]);

  const checkRateLimitLocal = useCallback((): boolean => {
    const now = Date.now();

    if (blockEndTime && now < blockEndTime) {
      return false;
    } else if (blockEndTime && now >= blockEndTime) {
      setIsBlocked(false);
      setBlockEndTime(null);
      requestLog.current = [];
      setRemainingRequests(finalConfig.maxRequests);
    }

    cleanOldRequests();

    if (requestLog.current.length >= finalConfig.maxRequests) {
      setIsBlocked(true);
      const endTime = now + finalConfig.blockDurationMs;
      setBlockEndTime(endTime);
      return false;
    }

    requestLog.current.push(now);
    setRemainingRequests(finalConfig.maxRequests - requestLog.current.length);
    return true;
  }, [blockEndTime, cleanOldRequests, finalConfig.maxRequests, finalConfig.blockDurationMs]);

  // Combined check (local + server)
  const checkRateLimit = useCallback(async (endpoint?: string): Promise<boolean> => {
    // First do quick local check
    if (!checkRateLimitLocal()) {
      return false;
    }
    
    // Then verify with server (don't block on this)
    checkRateLimitServer(endpoint);
    return true;
  }, [checkRateLimitLocal, checkRateLimitServer]);

  const getBlockTimeRemaining = useCallback((): number => {
    if (!blockEndTime) return 0;
    const remaining = blockEndTime - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }, [blockEndTime]);

  const resetRateLimit = useCallback(() => {
    requestLog.current = [];
    setIsBlocked(false);
    setBlockEndTime(null);
    setRemainingRequests(finalConfig.maxRequests);
  }, [finalConfig.maxRequests]);

  // Fetch protection stats
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke('anti-ddos', {
        body: { action: 'stats' },
        headers: { 'x-client-id': clientId.current }
      });

      if (data) {
        setStats({
          totalRequests: data.total_requests_1h || 0,
          blockedRequests: data.blocked_requests_1h || 0,
          activeBlocks: data.active_blocks || 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  // Check initial status on mount
  useEffect(() => {
    checkServerStatus();
    fetchStats();
  }, [checkServerStatus, fetchStats]);

  return {
    isBlocked,
    remainingRequests,
    checkRateLimit,
    checkRateLimitLocal,
    checkRateLimitServer,
    getBlockTimeRemaining,
    resetRateLimit,
    clientId: clientId.current,
    stats,
    fetchStats,
  };
};
