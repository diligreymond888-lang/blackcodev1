import { useState, useCallback, useRef } from 'react';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  blockDurationMs: number;
}

interface RequestLog {
  timestamp: number;
  count: number;
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 30, // Max 30 requests
  windowMs: 60000, // Per 1 minute
  blockDurationMs: 300000, // Block for 5 minutes
};

export const useAntiDDoS = (config: Partial<RateLimitConfig> = {}) => {
  const finalConfig = { ...defaultConfig, ...config };
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockEndTime, setBlockEndTime] = useState<number | null>(null);
  const [remainingRequests, setRemainingRequests] = useState(finalConfig.maxRequests);
  const requestLog = useRef<number[]>([]);

  const cleanOldRequests = useCallback(() => {
    const now = Date.now();
    requestLog.current = requestLog.current.filter(
      (timestamp) => now - timestamp < finalConfig.windowMs
    );
  }, [finalConfig.windowMs]);

  const checkRateLimit = useCallback((): boolean => {
    const now = Date.now();

    // Check if still blocked
    if (blockEndTime && now < blockEndTime) {
      return false;
    } else if (blockEndTime && now >= blockEndTime) {
      // Unblock
      setIsBlocked(false);
      setBlockEndTime(null);
      requestLog.current = [];
      setRemainingRequests(finalConfig.maxRequests);
    }

    // Clean old requests
    cleanOldRequests();

    // Check if over limit
    if (requestLog.current.length >= finalConfig.maxRequests) {
      setIsBlocked(true);
      const endTime = now + finalConfig.blockDurationMs;
      setBlockEndTime(endTime);
      return false;
    }

    // Log this request
    requestLog.current.push(now);
    setRemainingRequests(finalConfig.maxRequests - requestLog.current.length);
    return true;

  }, [blockEndTime, cleanOldRequests, finalConfig.maxRequests, finalConfig.blockDurationMs]);

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

  return {
    isBlocked,
    remainingRequests,
    checkRateLimit,
    getBlockTimeRemaining,
    resetRateLimit,
  };
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

  // Simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};
