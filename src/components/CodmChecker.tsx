import { useState, useRef } from 'react';
import { Play, Pause, Square, Upload, Search, Menu, Download, RefreshCw, Loader2, Phone, Zap, Shield, Rocket, TrendingUp, Heart, Users, Eye, Share2, Link2Off, X } from 'lucide-react';
import { getRandomUniqueEntries } from '@/data/garenaStock';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAntiDDoSContext } from './AntiDDoSProvider';
import RetryIndicator from './RetryIndicator';
import ProgressHeader from './ProgressHeader';

type Mode = 'checker' | 'searcher' | 'bomber' | 'booster' | 'remover';
interface KeyInfo {
  status: string;
  duration: string;
}

interface CodmCheckerProps {
  keyInfo: KeyInfo | null;
}

interface Stats {
  valid: number;
  invalid: number;
  clean: number;
  notClean: number;
  hasCodm: number;
}

interface SearcherStats {
  found: number;
  notFound: number;
  total: number;
}

interface BomberStats {
  success: number;
  fail: number;
  total: number;
  iterations: number;
}

type BoostType = 'tiktok_views' | 'tiktok_likes' | 'tiktok_followers' | 'telegram_views' | 'facebook_shares';

interface BoosterStats {
  success: number;
  fail: number;
  total: number;
}

interface RemoverStats {
  urlsRemoved: number;
  linesProcessed: number;
  totalLines: number;
}

interface LogEntry {
  id: number;
  message: string;
  type: 'valid' | 'invalid' | 'clean' | 'notClean' | 'hasCodm' | 'info' | 'found' | 'notFound' | 'success' | 'fail' | 'retry';
}

interface RetryState {
  isRetrying: boolean;
  currentRetry: number;
  maxRetries: number;
  accountIndex: number;
  totalAccounts: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LINES = 5000;
const MAX_PHONE_LENGTH = 15;
const MAX_URL_LENGTH = 500;

const sanitizeInput = (input: string): string => {
  return input.replace(/[<>'"&]/g, '').trim();
};

const validatePhoneNumber = (phone: string): boolean => {
  return /^(\+?[0-9]{7,15})$/.test(phone.replace(/[\s-]/g, ''));
};

const validateUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && url.length <= MAX_URL_LENGTH;
  } catch {
    return false;
  }
};

const CodmChecker = ({ keyInfo }: CodmCheckerProps) => {
  const { checkRateLimitLocal, remainingRequests, isBlocked } = useAntiDDoSContext();
  const [mode, setMode] = useState<Mode>('checker');
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bomberIterations, setBomberIterations] = useState(5);
  const [boostUrl, setBoostUrl] = useState('');
  const [selectedBoostType, setSelectedBoostType] = useState<BoostType>('tiktok_views');
  const [boosterStats, setBoosterStats] = useState<BoosterStats>({ success: 0, fail: 0, total: 0 });
  const [removerStats, setRemoverStats] = useState<RemoverStats>({ urlsRemoved: 0, linesProcessed: 0, totalLines: 0 });
  const [cleanedContent, setCleanedContent] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({ valid: 0, invalid: 0, clean: 0, notClean: 0, hasCodm: 0 });
  const [searcherStats, setSearcherStats] = useState<SearcherStats>({ found: 0, notFound: 0, total: 0 });
  const [bomberStats, setBomberStats] = useState<BomberStats>({ success: 0, fail: 0, total: 0, iterations: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outputFiles, setOutputFiles] = useState<string[]>([]);
  const [foundResults, setFoundResults] = useState<string[]>([]);
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(0);
  const [checkerResults, setCheckerResults] = useState<{
    valid: string[];
    invalid: string[];
    clean: string[];
    notClean: string[];
    hasCodm: string[];
  }>({ valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryState, setRetryState] = useState<RetryState>({
    isRetrying: false,
    currentRetry: 0,
    maxRetries: 3,
    accountIndex: 0,
    totalAccounts: 0,
  });
  const logIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const shouldStopRef = useRef(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Security: validate file size
      if (selectedFile.size > MAX_FILE_SIZE) {
        toast.error('File too large. Maximum size is 5MB.');
        return;
      }
      
      // Security: validate file type
      if (!selectedFile.name.endsWith('.txt') && !selectedFile.name.endsWith('.csv')) {
        toast.error('Invalid file type. Only .txt and .csv files are allowed.');
        return;
      }
      
      setFile(selectedFile);
      addLog(`File selected: ${sanitizeInput(selectedFile.name)}`, 'info');
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        let lines = content.split('\n').filter(line => line.trim() !== '');
        
        // Security: limit lines
        if (lines.length > MAX_LINES) {
          toast.warning(`File truncated to ${MAX_LINES} lines.`);
          lines = lines.slice(0, MAX_LINES);
        }
        
        setFileLines(lines);
        addLog(`Loaded ${lines.length} lines from file`, 'info');
      };
      reader.readAsText(selectedFile);
    }
  };

  const addLog = (message: string, type: LogEntry['type']) => {
    logIdRef.current += 1;
    setLogs(prev => {
      // Keep max 500 log entries for performance
      const newLogs = [...prev, { id: logIdRef.current, message, type }];
      return newLogs.length > 500 ? newLogs.slice(-500) : newLogs;
    });
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }, 50);
  };

  const resetStats = () => {
    setStats({ valid: 0, invalid: 0, clean: 0, notClean: 0, hasCodm: 0 });
    setSearcherStats({ found: 0, notFound: 0, total: 0 });
    setBomberStats({ success: 0, fail: 0, total: 0, iterations: 0 });
    setBoosterStats({ success: 0, fail: 0, total: 0 });
    setRemoverStats({ urlsRemoved: 0, linesProcessed: 0, totalLines: 0 });
    setCleanedContent([]);
    setLogs([]);
    setOutputFiles([]);
    setFoundResults([]);
    setCheckerResults({ valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] });
    setCurrentProcessingIndex(0);
    setRetryState({ isRetrying: false, currentRetry: 0, maxRetries: 3, accountIndex: 0, totalAccounts: 0 });
  };

  const handleRefresh = () => {
    resetStats();
    setPhoneNumber('');
    setBoostUrl('');
    addLog('Ready...', 'info');
  };

  const getDownloadDescription = () => {
    return `\n\n========================================\nModified by @BlackCodeHat\n\nTHANK YOU FOR USING\n========================================`;
  };

  const triggerDownload = (content: string, filename: string) => {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = sanitizeInput(filename);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Cleanup after a delay
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      return true;
    } catch (err) {
      console.error('Download failed:', err);
      toast.error('Download failed. Please try again.');
      return false;
    }
  };

  const handleDownload = () => {
    if (foundResults.length === 0) {
      toast.error('No results to download.');
      return;
    }
    const content = foundResults.join('\n') + getDownloadDescription();
    if (triggerDownload(content, `garena_results_${Date.now()}.txt`)) {
      addLog('Results downloaded!', 'info');
      toast.success('File downloaded successfully!');
    }
  };

  const handleDownloadCategory = (category: keyof typeof checkerResults, label: string) => {
    const results = checkerResults[category];
    if (results.length === 0) {
      toast.error(`No ${label} results to download.`);
      return;
    }
    const content = results.join('\n') + getDownloadDescription();
    if (triggerDownload(content, `${label.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.txt`)) {
      addLog(`${label} results downloaded! (${results.length} entries)`, 'info');
      toast.success(`${label} results downloaded!`);
    }
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setMenuOpen(false);
    resetStats();
    setFile(null);
    setPhoneNumber('');
    setBoostUrl('');
    const modeNames = {
      checker: 'CODM Checker',
      searcher: 'Searcher Domain',
      bomber: 'SMS Bomber',
      booster: 'Social Boost',
      remover: 'URL Remover'
    };
    addLog(`Switched to ${modeNames[newMode]} mode`, 'info');
  };

  const handleStart = async () => {
    if (isBlocked) {
      toast.error('Access blocked. Please wait for the cooldown period.');
      return;
    }

    if (!checkRateLimitLocal()) {
      addLog('Rate limit exceeded! Please wait before making more requests.', 'info');
      toast.error('Rate limit exceeded! Please wait before trying again.');
      return;
    }

    if (mode === 'checker' && !file) {
      toast.error('Please upload a file first!');
      return;
    }
    if (mode === 'checker' && fileLines.length === 0) {
      toast.error('Please wait for file to load or select a valid file.');
      return;
    }
    if (mode === 'searcher' && !selectedDomain) {
      toast.error('Please select Garena Domain!');
      return;
    }
    if (mode === 'bomber') {
      const cleanPhone = phoneNumber.replace(/[\s-]/g, '');
      if (!cleanPhone || !validatePhoneNumber(cleanPhone)) {
        toast.error('Please enter a valid phone number!');
        return;
      }
    }
    if (mode === 'booster') {
      if (!boostUrl.trim() || !validateUrl(boostUrl.trim())) {
        toast.error('Please enter a valid URL (https://...)!');
        return;
      }
    }
    if (mode === 'remover' && (!file || fileLines.length === 0)) {
      toast.error('Please upload a file first!');
      return;
    }
    
    shouldStopRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    setIsProcessing(true);
    setCurrentProcessingIndex(0);
    
    const modeNames = { checker: 'checker', searcher: 'searcher', bomber: 'SMS bomber', booster: 'social boost', remover: 'URL remover' };
    addLog(`Starting ${modeNames[mode]}...`, 'info');
    
    if (mode === 'checker') await processChecking();
    else if (mode === 'searcher') simulateSearching();
    else if (mode === 'bomber') await processBombing();
    else if (mode === 'booster') await processBoosting();
    else if (mode === 'remover') processRemovingUrls();
    
    setIsProcessing(false);
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
    addLog(isPaused ? 'Resuming...' : 'Paused', 'info');
  };

  const handleStop = () => {
    shouldStopRef.current = true;
    setIsRunning(false);
    setIsPaused(false);
    setIsProcessing(false);
    setRetryState(prev => ({ ...prev, isRetrying: false }));
    addLog('Stopped', 'info');
  };

  const processChecking = async () => {
    if (fileLines.length === 0) {
      addLog('Please upload a file first!', 'info');
      setIsRunning(false);
      return;
    }

    const validLines = fileLines.filter(line => {
      const parts = line.split(':');
      return parts.length >= 2 && parts[0].trim() && parts[1].trim();
    });

    if (validLines.length === 0) {
      addLog('No valid accounts found! Format: account:password', 'info');
      toast.error('Invalid file format. Each line should be: account:password');
      setIsRunning(false);
      return;
    }

    if (validLines.length !== fileLines.length) {
      addLog(`Found ${validLines.length} valid accounts (${fileLines.length - validLines.length} skipped)`, 'info');
    }

    addLog(`Processing ${validLines.length} accounts...`, 'info');
    setRetryState(prev => ({ ...prev, totalAccounts: validLines.length }));
    
    const tempResults: typeof checkerResults = { valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] };
    const maxRetries = 3;
    
    for (let i = 0; i < validLines.length; i++) {
      if (shouldStopRef.current) {
        addLog('Checking stopped by user.', 'info');
        break;
      }
      
      const account = validLines[i];
      const accountNum = i + 1;
      setCurrentProcessingIndex(accountNum);
      setRetryState(prev => ({ ...prev, accountIndex: accountNum, currentRetry: 0, isRetrying: false }));
      
      let retryCount = 0;
      let success = false;
      
      while (!success && retryCount < maxRetries && !shouldStopRef.current) {
        if (!checkRateLimitLocal()) {
          addLog('⏳ Rate limited! Waiting 30 seconds...', 'retry');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }
        
        try {
          if (retryCount > 0) {
            setRetryState(prev => ({ ...prev, currentRetry: retryCount, isRetrying: true }));
            addLog(`🔄 [${accountNum}/${validLines.length}] Retry ${retryCount}/${maxRetries}: ${account.split(':')[0]}`, 'retry');
          } else {
            addLog(`[${accountNum}/${validLines.length}] Checking: ${account.split(':')[0]}...`, 'info');
          }
          
          const { data, error } = await supabase.functions.invoke('codm-checker', {
            body: { accounts: [account] }
          });

          if (error) {
            if (error.message?.includes('429') || error.message?.includes('rate limit')) {
              const waitTime = 60;
              addLog(`⚠️ Rate limited! Waiting ${waitTime}s...`, 'retry');
              toast.warning(`Rate limited. Waiting ${waitTime} seconds...`);
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
              retryCount++;
              continue;
            }
            
            addLog(`❌ API Error: ${error.message}`, 'invalid');
            retryCount++;
            
            if (retryCount < maxRetries) {
              const waitTime = retryCount * 5;
              setRetryState(prev => ({ ...prev, currentRetry: retryCount, isRetrying: true }));
              addLog(`⏳ Retrying in ${waitTime}s...`, 'retry');
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
            continue;
          }

          success = true;
          setRetryState(prev => ({ ...prev, isRetrying: false, currentRetry: 0 }));

          if (data?.results && Array.isArray(data.results) && data.results.length > 0) {
            const result = data.results[0];
            let logType: LogEntry['type'] = 'info';
            let statKey: keyof Stats | null = null;
            let formattedLog = '';
            
            if (result.status === 'valid') {
              const details = result.details || {};
              const codm = result.codm || {};
              
              // Build detailed log matching v7.py output format
              const cleanStatus = result.isClean ? 'CLEAN' : 'NOT CLEAN';
              const emailVer = details.email_verified ? 'Verified' : 'Not Verified';
              const mobileBound = details.mobile_bound || (details.mobile_no && details.mobile_no !== 'N/A' ? 'Yes' : 'No');
              const fbLinked = details.facebook_linked || (details.facebook_connected ? 'Linked' : 'Not Linked');
              const twoFA = details.two_step_verify ? 'Yes' : 'No';
              const authApp = details.authenticator ? 'Yes' : 'No';
              
              // Detailed formatted log (for display)
              const logLines = [
                `═══════════════════════════════`,
                `  LOGIN SUCCESSFUL`,
                `  STATUS: ${cleanStatus}`,
                `  USER:PASS: ${result.account}:${result.password}`,
                details.last_login ? `  LAST LOGIN: ${details.last_login}` : null,
                details.last_login_where ? `  LOCATION: ${details.last_login_where}` : null,
                details.ip_address ? `  IP: ${details.ip_address}` : null,
                `  SERVER: ${details.country || 'N/A'}`,
                ``,
                `  GAME INFO`,
                result.hasCodm ? `  CODM Nickname: ${codm.codm_nickname || 'N/A'}` : `  CODM: No CODM`,
                result.hasCodm ? `  CODM UID: ${codm.uid || 'N/A'}` : null,
                result.hasCodm ? `  CODM Level: ${codm.codm_level || 'N/A'}` : null,
                result.hasCodm ? `  CODM Region: ${codm.region || 'N/A'}` : null,
                `  Shells: ${details.shell_balance || 0}`,
                `  Mobile: ${details.mobile_no || 'N/A'}`,
                `  Email: ${details.email || 'N/A'} (${emailVer})`,
                ``,
                `  BIND STATUS`,
                `  Mobile Bound: ${mobileBound}`,
                `  Email Verified: ${details.email_verified ? 'Yes' : 'No'}`,
                `  Facebook: ${fbLinked}`,
                details.facebook_profile && details.facebook_profile !== 'N/A' ? `  FB Profile: ${details.facebook_profile}` : null,
                `  Authenticator: ${authApp}`,
                `  2FA: ${twoFA}`,
                `  Security: ${details.security_status || 'Normal'}`,
                `═══════════════════════════════`,
              ].filter(Boolean).join('\n');
              
              // Short format for results file
              formattedLog = [
                `Account: ${result.account}:${result.password}`,
                `UID: ${details.uid || 'N/A'}`,
                `Nickname: ${details.nickname || 'N/A'}`,
                `Email: ${details.email || 'N/A'} (${emailVer})`,
                `Mobile: ${details.mobile_no || 'N/A'}`,
                `Country: ${details.country || 'N/A'}`,
                `Shell: ${details.shell_balance || 0}`,
                `Bind: ${details.bind_status || 'N/A'}`,
                `Security: ${details.security_status || 'Normal'}`,
                `FB: ${fbLinked}`,
                `2FA: ${twoFA}`,
                `Auth: ${authApp}`,
                result.hasCodm ? `CODM: ${codm.codm_nickname || 'N/A'} (Lv.${codm.codm_level || '?'}) Region:${codm.region || 'N/A'}` : 'CODM: No',
                `Status: ${cleanStatus}`
              ].join(' | ');
              
              if (result.hasCodm) {
                logType = 'hasCodm';
                statKey = 'hasCodm';
              } else if (result.isClean) {
                logType = 'clean';
                statKey = 'clean';
              } else {
                logType = 'notClean';
                statKey = 'notClean';
              }
              
              setStats(prev => ({ ...prev, valid: prev.valid + 1 }));
              tempResults.valid.push(formattedLog);
              
              // Log detailed view line by line
              logLines.split('\n').forEach(line => {
                if (line.trim()) addLog(line, logType);
              });
              
            } else if (result.status === 'invalid') {
              formattedLog = `Account: ${result.account || 'Unknown'} | Status: INVALID | ${result.message || 'Login failed'}`;
              logType = 'invalid';
              statKey = 'invalid';
              addLog(`[INVALID] ${formattedLog}`, logType);
            } else {
              formattedLog = `Account: ${result.account || 'Unknown'} | Status: ERROR | ${result.message || 'Unknown error'}`;
              logType = 'invalid';
              statKey = 'invalid';
              addLog(`[ERROR] ${formattedLog}`, logType);
            }
            
            if (statKey) {
              tempResults[statKey].push(formattedLog);
              setStats(prev => ({ ...prev, [statKey]: prev[statKey] + 1 }));
            }
          }
        } catch (err) {
          addLog(`❌ Error checking account: ${err}`, 'invalid');
          retryCount++;
          
          if (retryCount < maxRetries) {
            const waitTime = retryCount * 5;
            setRetryState(prev => ({ ...prev, currentRetry: retryCount, isRetrying: true }));
            addLog(`🔄 Retrying in ${waitTime}s... (attempt ${retryCount}/${maxRetries})`, 'retry');
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          }
        }
      }
      
      if (!success) {
        addLog(`💀 Failed: ${account.split(':')[0]} after ${maxRetries} retries`, 'invalid');
        tempResults.invalid.push(`Account: ${account.split(':')[0]} | Status: ERROR | Failed after retries`);
        setStats(prev => ({ ...prev, invalid: prev.invalid + 1 }));
        setRetryState(prev => ({ ...prev, isRetrying: false }));
      }
      
      if (i + 1 < validLines.length && !shouldStopRef.current) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    setIsRunning(false);
    setCheckerResults(tempResults);
    setRetryState(prev => ({ ...prev, isRetrying: false, currentRetry: 0 }));
    addLog('✅ Checking complete!', 'info');
    toast.success(`Completed! Valid: ${tempResults.valid.length}, Invalid: ${tempResults.invalid.length}`);
  };

  const simulateSearching = () => {
    const stockEntries = getRandomUniqueEntries(30);
    let count = 0;
    const results: string[] = [];

    addLog('Searching in Garena Domain.txt...', 'info');
    addLog(`Processing ${stockEntries.length} entries...`, 'info');

    const interval = setInterval(() => {
      if (count >= stockEntries.length) {
        clearInterval(interval);
        setIsRunning(false);
        setFoundResults(results);
        if (results.length > 0) {
          setOutputFiles([`garena_results_${Date.now()}.txt`]);
        }
        addLog(`✅ Search complete! Found ${results.length} matches.`, 'info');
        return;
      }

      const entry = stockEntries[count];
      results.push(entry);
      addLog(`[FOUND] ${entry}`, 'found');
      setSearcherStats(prev => ({
        ...prev,
        found: prev.found + 1,
        total: prev.total + 1,
      }));
      setCurrentProcessingIndex(count + 1);
      
      count++;
    }, 150);
  };

  const processBombing = async () => {
    const cleanPhone = sanitizeInput(phoneNumber.replace(/[\s-]/g, ''));
    
    addLog(`Target: ${cleanPhone}`, 'info');
    addLog(`Starting ${bomberIterations} iterations...`, 'info');

    try {
      for (let i = 0; i < bomberIterations; i++) {
        if (shouldStopRef.current) {
          addLog('Bombing stopped by user.', 'info');
          break;
        }

        if (!checkRateLimitLocal()) {
          addLog('⏳ Rate limited! Waiting 30 seconds...', 'retry');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }

        addLog(`[${i + 1}/${bomberIterations}] Sending batch requests...`, 'info');
        setCurrentProcessingIndex(i + 1);

        const { data, error } = await supabase.functions.invoke('sms-bomber', {
          body: { phone: cleanPhone, iterations: 1 }
        });

        if (error) {
          addLog(`❌ Error: ${error.message}`, 'fail');
          continue;
        }

        if (data?.results && Array.isArray(data.results)) {
          for (const iteration of data.results) {
            for (const result of iteration.results) {
              if (result.success) {
                addLog(`   ✓ ${result.name}`, 'success');
                setBomberStats(prev => ({ ...prev, success: prev.success + 1, total: prev.total + 1 }));
              } else {
                addLog(`   ✗ ${result.name}`, 'fail');
                setBomberStats(prev => ({ ...prev, fail: prev.fail + 1, total: prev.total + 1 }));
              }
            }
          }
        }

        setBomberStats(prev => ({ ...prev, iterations: i + 1 }));

        if (i + 1 < bomberIterations && !shouldStopRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setIsRunning(false);
      addLog('✅ Bombing complete!', 'info');
      toast.success('SMS Bombing complete!');
    } catch (err) {
      addLog(`❌ Error: ${err}`, 'fail');
      setIsRunning(false);
    }
  };

  const processBoosting = async () => {
    const cleanUrl = sanitizeInput(boostUrl.trim());

    const boostTypeLabels: Record<BoostType, string> = {
      tiktok_views: 'TikTok Views',
      tiktok_likes: 'TikTok Likes',
      tiktok_followers: 'TikTok Followers',
      telegram_views: 'Telegram Views',
      facebook_shares: 'Facebook Shares',
    };

    addLog(`Boosting: ${boostTypeLabels[selectedBoostType]}`, 'info');
    addLog(`URL: ${cleanUrl}`, 'info');

    try {
      if (!checkRateLimitLocal()) {
        addLog('⏳ Rate limited! Please wait...', 'retry');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      addLog('Sending boost request...', 'info');

      const { data, error } = await supabase.functions.invoke('social-boost', {
        body: { action: selectedBoostType, url: cleanUrl }
      });

      if (error) {
        addLog(`❌ Error: ${error.message}`, 'fail');
        setBoosterStats(prev => ({ ...prev, fail: prev.fail + 1, total: prev.total + 1 }));
        toast.error(`Boost failed: ${error.message}`);
      } else if (data?.success) {
        addLog(`✓ ${data.message}`, 'success');
        if (data.orderId) addLog(`Order ID: ${data.orderId}`, 'info');
        if (data.userInfo) addLog(`User: ${data.userInfo.nickname} (${data.userInfo.followers} followers)`, 'info');
        setBoosterStats(prev => ({ ...prev, success: prev.success + 1, total: prev.total + 1 }));
        toast.success(data.message);
      } else {
        addLog(`✗ ${data?.message || data?.error || 'Boost failed'}`, 'fail');
        setBoosterStats(prev => ({ ...prev, fail: prev.fail + 1, total: prev.total + 1 }));
        toast.error(data?.message || data?.error || 'Boost failed');
      }

      setIsRunning(false);
      addLog('Boost request complete!', 'info');
    } catch (err) {
      addLog(`❌ Error: ${err}`, 'fail');
      setBoosterStats(prev => ({ ...prev, fail: prev.fail + 1, total: prev.total + 1 }));
      setIsRunning(false);
    }
  };

  const processRemovingUrls = () => {
    if (fileLines.length === 0) {
      setIsRunning(false);
      return;
    }

    const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`[\]]+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|co|me|app|dev|xyz|info|biz|gov|edu|mil|int|pro|name|museum|aero|jobs|mobi|tel|travel|asia|cat|coop|ly|gg|tv|fm|cc|us|uk|ca|au|de|fr|es|it|nl|ru|cn|jp|kr|in|br|mx|za|ng|ke|eg|ph|id|my|sg|hk|tw|vn|th|pk|bd|lk|np|ae|sa|qa|kw|bh|om|jo|lb|sy|iq|ir|il|tr|ua|pl|cz|sk|hu|ro|bg|hr|rs|si|ba|mk|al|me|gr|cy|mt|pt|be|ch|at|se|no|dk|fi|is|ie|lu|li|mc|ad|sm|va|ee|lv|lt|by|md|am|ge|az|kz|uz|tm|kg|tj|mn|af)(?:\/[^\s<>"{}|\\^`[\]]*)?/gi;
    
    const cleanedLines: string[] = [];
    let totalUrlsRemoved = 0;
    let linesWithUrls = 0;
    
    addLog(`Scanning ${fileLines.length} lines for URLs...`, 'info');
    setRemoverStats(prev => ({ ...prev, totalLines: fileLines.length }));

    let lineIndex = 0;
    
    const processLine = () => {
      if (shouldStopRef.current || lineIndex >= fileLines.length) {
        setIsRunning(false);
        setCleanedContent(cleanedLines);
        if (cleanedLines.length > 0) {
          setOutputFiles([`cleaned_${Date.now()}.txt`]);
        }
        addLog(`✅ Complete! Removed ${totalUrlsRemoved} URLs from ${linesWithUrls} lines.`, 'success');
        toast.success(`Removed ${totalUrlsRemoved} URLs from ${linesWithUrls} lines!`);
        return;
      }

      const line = fileLines[lineIndex];
      const urlMatches = line.match(urlPattern) || [];
      const urlCount = urlMatches.length;
      
      if (urlCount > 0) {
        linesWithUrls++;
        const cleanedLine = line.replace(urlPattern, '').replace(/\s+/g, ' ').trim();
        
        urlMatches.forEach((url) => {
          addLog(`[Line ${lineIndex + 1}] Removed: ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}`, 'success');
        });
        
        totalUrlsRemoved += urlCount;
        
        if (cleanedLine) {
          cleanedLines.push(cleanedLine);
        }
      } else {
        if (line.trim()) cleanedLines.push(line);
      }
      
      setRemoverStats({ urlsRemoved: totalUrlsRemoved, linesProcessed: lineIndex + 1, totalLines: fileLines.length });
      setCurrentProcessingIndex(lineIndex + 1);
      
      lineIndex++;
      setTimeout(processLine, urlCount > 0 ? 100 : 10);
    };

    processLine();
  };

  const handleDownloadCleaned = () => {
    if (cleanedContent.length === 0) {
      toast.error('No cleaned content to download.');
      return;
    }
    const content = cleanedContent.join('\n') + getDownloadDescription();
    if (triggerDownload(content, `cleaned_${Date.now()}.txt`)) {
      addLog('Cleaned file downloaded!', 'info');
      toast.success('File downloaded!');
    }
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'valid': return 'text-green-400';
      case 'invalid': return 'text-red-400';
      case 'clean': return 'text-blue-400';
      case 'notClean': return 'text-orange-400';
      case 'hasCodm': return 'text-purple-400';
      case 'found': return 'text-primary';
      case 'notFound': return 'text-red-400';
      case 'success': return 'text-green-400';
      case 'fail': return 'text-red-400';
      case 'retry': return 'text-warning';
      default: return 'text-muted-foreground';
    }
  };

  const getTotalItems = () => {
    if (mode === 'checker') return fileLines.filter(l => l.split(':').length >= 2).length;
    if (mode === 'searcher') return 30;
    if (mode === 'bomber') return bomberIterations;
    if (mode === 'remover') return removerStats.totalLines || fileLines.length;
    return 0;
  };

  const modeConfig = [
    { mode: 'checker' as Mode, label: 'CODM Checker', icon: Play, shortLabel: 'Checker' },
    { mode: 'searcher' as Mode, label: 'Searcher Domain', icon: Search, shortLabel: 'Searcher' },
    { mode: 'bomber' as Mode, label: 'SMS Bomber', icon: Zap, shortLabel: 'Bomber' },
    { mode: 'booster' as Mode, label: 'Social Boost', icon: Rocket, shortLabel: 'Booster' },
    { mode: 'remover' as Mode, label: 'URL Remover', icon: Link2Off, shortLabel: 'Remover' },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 px-4">
      {/* Header with Menu */}
      <div className="relative pt-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="absolute left-0 top-2 p-2.5 text-primary/80 hover:text-primary transition-colors z-10 rounded-lg hover:bg-primary/5"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Dropdown Menu */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 top-12 z-50 rounded-xl glass-panel overflow-hidden min-w-[200px] border border-primary/20 shadow-lg shadow-primary/10">
              {modeConfig.map((item) => (
                <button
                  key={item.mode}
                  onClick={() => handleModeChange(item.mode)}
                  className={`w-full px-4 py-3.5 text-left text-sm font-medium transition-all flex items-center gap-3
                    ${mode === item.mode 
                      ? 'bg-primary/15 text-primary border-l-2 border-primary' 
                      : 'text-foreground/80 hover:bg-secondary/50 hover:text-foreground border-l-2 border-transparent'}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Title */}
        <h2 className="text-xl sm:text-2xl font-display font-bold text-center glow-text text-foreground pt-1 tracking-wide">
          {modeConfig.find(m => m.mode === mode)?.label}
        </h2>
        
        {/* Progress Header */}
        <div className="mt-3">
          <ProgressHeader
            isRunning={isRunning}
            currentIndex={currentProcessingIndex}
            totalItems={getTotalItems()}
            remainingRequests={remainingRequests}
          />
        </div>

        {/* Key Info */}
        {keyInfo && (
          <div className="flex items-center justify-center gap-1.5 mt-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${
              keyInfo.status === 'Valid' ? 'bg-green-500 shadow-[0_0_4px_hsl(142_76%_46%/0.5)]' : 'bg-red-500'
            }`} />
            <span className="text-muted-foreground font-mono">{keyInfo.duration}</span>
          </div>
        )}
      </div>

      {/* Retry Indicator */}
      {mode === 'checker' && (
        <RetryIndicator
          currentRetry={retryState.currentRetry}
          maxRetries={retryState.maxRetries}
          isRetrying={retryState.isRetrying}
          accountIndex={retryState.accountIndex}
          totalAccounts={retryState.totalAccounts}
        />
      )}

      {/* Main Content Area */}
      <div className="space-y-4">
        {mode === 'searcher' ? (
          <>
            <div 
              onClick={() => setSelectedDomain(!selectedDomain)}
              className={`neon-border rounded-xl glass-panel px-4 py-3.5 
                         flex items-center gap-3 cursor-pointer transition-all
                         ${selectedDomain ? 'border-primary/40' : ''}`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0
                ${selectedDomain ? 'border-primary bg-primary/20' : 'border-muted-foreground'}`}>
                {selectedDomain && <div className="w-2.5 h-2.5 bg-primary rounded-sm" />}
              </div>
              <span className="text-foreground text-sm font-medium">Garena Domain.txt</span>
            </div>
            <div className="flex justify-center gap-3 pt-1">
              <button onClick={handleStart} disabled={isRunning || !selectedDomain}
                className="neon-button px-8 py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                <Search className="w-4 h-4" /> Search
              </button>
              <button onClick={handleRefresh} disabled={isRunning}
                className="neon-button px-6 py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
          </>
        ) : mode === 'bomber' ? (
          <div className="space-y-4">
            <div className="neon-border rounded-xl glass-panel px-4 py-4">
              <label className="text-muted-foreground text-xs font-medium block mb-2">Target Phone Number</label>
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-primary shrink-0" />
                <input type="text" value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.slice(0, MAX_PHONE_LENGTH))}
                  placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                  className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted-foreground/50 focus:outline-none font-mono"
                  disabled={isRunning} />
              </div>
            </div>
            <div className="neon-border rounded-xl glass-panel px-4 py-4">
              <label className="text-muted-foreground text-xs font-medium block mb-3">Number of Iterations</label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 5, 10].map((num) => (
                  <button key={num} onClick={() => setBomberIterations(num)} disabled={isRunning}
                    className={`py-2.5 rounded-lg text-sm font-medium transition-all
                      ${bomberIterations === num 
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                        : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
                      } disabled:opacity-50`}>
                    {num}x Blast
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button onClick={handleStart} disabled={isRunning || !phoneNumber.trim()}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Zap className="w-4 h-4" /> Start
              </button>
              <button onClick={handleStop} disabled={!isRunning}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Square className="w-4 h-4" /> Stop
              </button>
              <button onClick={handleRefresh} disabled={isRunning}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" /> Reset
              </button>
            </div>
          </div>
        ) : mode === 'booster' ? (
          <div className="space-y-4">
            <div className="neon-border rounded-xl glass-panel px-4 py-4">
              <label className="text-muted-foreground text-xs font-medium block mb-2">URL to Boost</label>
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-primary shrink-0" />
                <input type="url" value={boostUrl}
                  onChange={(e) => setBoostUrl(e.target.value.slice(0, MAX_URL_LENGTH))}
                  placeholder="https://tiktok.com/... or t.me/..."
                  className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted-foreground/50 focus:outline-none font-mono text-sm"
                  disabled={isRunning} />
              </div>
            </div>
            <div className="neon-border rounded-xl glass-panel px-4 py-4">
              <label className="text-muted-foreground text-xs font-medium block mb-3">Boost Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([
                  { type: 'tiktok_views' as BoostType, label: 'TikTok Views', icon: Eye, color: 'text-pink-400' },
                  { type: 'tiktok_likes' as BoostType, label: 'TikTok Likes', icon: Heart, color: 'text-red-400' },
                  { type: 'tiktok_followers' as BoostType, label: 'TikTok Followers', icon: Users, color: 'text-blue-400' },
                  { type: 'telegram_views' as BoostType, label: 'Telegram Views', icon: Eye, color: 'text-sky-400' },
                  { type: 'facebook_shares' as BoostType, label: 'FB Shares', icon: Share2, color: 'text-blue-600' },
                ]).map((boost) => (
                  <button key={boost.type} onClick={() => setSelectedBoostType(boost.type)} disabled={isRunning}
                    className={`py-2.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5
                      ${selectedBoostType === boost.type 
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                        : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
                      } disabled:opacity-50`}>
                    <boost.icon className={`w-3.5 h-3.5 ${selectedBoostType === boost.type ? '' : boost.color}`} />
                    <span className="truncate">{boost.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button onClick={handleStart} disabled={isRunning || !boostUrl.trim()}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Rocket className="w-4 h-4" /> Boost
              </button>
              <button onClick={handleStop} disabled={!isRunning}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Square className="w-4 h-4" /> Stop
              </button>
              <button onClick={handleRefresh} disabled={isRunning}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" /> Reset
              </button>
            </div>
          </div>
        ) : mode === 'remover' ? (
          <div className="space-y-4">
            <div className="neon-border rounded-xl glass-panel px-4 py-3.5 flex items-center gap-3 cursor-pointer transition-all hover:border-primary/40"
              onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4 text-foreground shrink-0" />
              <span className="text-muted-foreground text-sm truncate flex-1">
                {file ? file.name : 'Choose file (.txt, .csv)'}
              </span>
              {file && <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); setFile(null); setFileLines([]); }} />}
              <input ref={fileInputRef} type="file" accept=".txt,.csv" onChange={handleFileChange} className="hidden" />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button onClick={handleStart} disabled={isRunning || !file}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Link2Off className="w-4 h-4" /> Remove
              </button>
              <button onClick={handleStop} disabled={!isRunning}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Square className="w-4 h-4" /> Stop
              </button>
              <button onClick={handleDownloadCleaned} disabled={cleanedContent.length === 0}
                className="neon-button py-3 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Checker: File Upload */}
            <div className="neon-border rounded-xl glass-panel px-4 py-3.5 flex items-center gap-3 cursor-pointer transition-all hover:border-primary/40"
              onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4 text-foreground shrink-0" />
              <span className="text-muted-foreground text-sm truncate flex-1">
                {file ? `${file.name} (${fileLines.length} accounts)` : 'Choose file (.txt, .csv)'}
              </span>
              {file && <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); setFile(null); setFileLines([]); }} />}
              <input ref={fileInputRef} type="file" accept=".txt,.csv" onChange={handleFileChange} className="hidden" />
            </div>

            {/* Control Buttons */}
            <div className="flex justify-center gap-3 pt-1">
              <button onClick={handleStart} disabled={isRunning && !isPaused}
                className="neon-button px-6 py-2.5 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isProcessing ? 'Checking...' : 'Start'}
              </button>
              <button onClick={handlePause} disabled={!isRunning}
                className="neon-button px-6 py-2.5 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                <Pause className="w-4 h-4" /> Pause
              </button>
              <button onClick={handleStop} disabled={!isRunning}
                className="neon-button px-6 py-2.5 rounded-xl font-display text-sm font-medium text-foreground
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                <Square className="w-4 h-4" /> Stop
              </button>
            </div>
          </>
        )}
      </div>

      {/* Stats Section */}
      {mode === 'searcher' ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Found', value: searcherStats.found, color: 'text-primary' },
            { label: 'Not Found', value: searcherStats.notFound, color: 'text-red-400' },
            { label: 'Total', value: searcherStats.total, color: 'text-foreground' },
          ].map((stat, index) => (
            <div key={index} className="stat-card neon-border rounded-xl glass-panel p-3 sm:p-4 text-center">
              <p className="text-muted-foreground text-[11px] font-medium mb-1 uppercase tracking-wider">{stat.label}</p>
              <p className={`text-xl sm:text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      ) : mode === 'bomber' ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Success', value: bomberStats.success, color: 'text-green-400' },
            { label: 'Failed', value: bomberStats.fail, color: 'text-red-400' },
            { label: 'Total', value: bomberStats.total, color: 'text-foreground' },
            { label: 'Rounds', value: bomberStats.iterations, color: 'text-primary' },
          ].map((stat, index) => (
            <div key={index} className="stat-card neon-border rounded-xl glass-panel p-2 sm:p-3 text-center">
              <p className="text-muted-foreground text-[10px] sm:text-[11px] font-medium mb-1 uppercase tracking-wider">{stat.label}</p>
              <p className={`text-lg sm:text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      ) : mode === 'booster' ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Success', value: boosterStats.success, color: 'text-green-400' },
            { label: 'Failed', value: boosterStats.fail, color: 'text-red-400' },
            { label: 'Total', value: boosterStats.total, color: 'text-foreground' },
          ].map((stat, index) => (
            <div key={index} className="stat-card neon-border rounded-xl glass-panel p-3 sm:p-4 text-center">
              <p className="text-muted-foreground text-[11px] font-medium mb-1 uppercase tracking-wider">{stat.label}</p>
              <p className={`text-xl sm:text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      ) : mode === 'remover' ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'URLs Removed', value: removerStats.urlsRemoved, color: 'text-green-400' },
            { label: 'Processed', value: removerStats.linesProcessed, color: 'text-primary' },
            { label: 'Total', value: removerStats.totalLines, color: 'text-foreground' },
          ].map((stat, index) => (
            <div key={index} className="stat-card neon-border rounded-xl glass-panel p-3 sm:p-4 text-center">
              <p className="text-muted-foreground text-[11px] font-medium mb-1 uppercase tracking-wider">{stat.label}</p>
              <p className={`text-xl sm:text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Valid', value: stats.valid, color: 'text-green-400', key: 'valid' as const },
            { label: 'Invalid', value: stats.invalid, color: 'text-red-400', key: 'invalid' as const },
            { label: 'Clean', value: stats.clean, color: 'text-blue-400', key: 'clean' as const },
            { label: 'Not Clean', value: stats.notClean, color: 'text-orange-400', key: 'notClean' as const },
            { label: 'Has CODM', value: stats.hasCodm, color: 'text-purple-400', key: 'hasCodm' as const },
          ].map((stat) => (
            <div key={stat.key}
              className="stat-card neon-border rounded-xl glass-panel p-2 sm:p-3 text-center group"
              onClick={() => stat.value > 0 && handleDownloadCategory(stat.key, stat.label)}
              title={stat.value > 0 ? `Click to download ${stat.label} results` : ''}>
              <p className="text-muted-foreground text-[10px] sm:text-[11px] font-medium mb-1 truncate uppercase tracking-wider">{stat.label}</p>
              <p className={`text-lg sm:text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
              {stat.value > 0 && (
                <Download className="w-3 h-3 mx-auto mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Log Output */}
      <div ref={logContainerRef}
        className="neon-border rounded-xl glass-panel h-52 sm:h-64 overflow-y-auto p-4">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
            <Loader2 className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-sm">Logs will appear here...</p>
          </div>
        ) : (
          <div className="space-y-0.5 font-mono text-[11px]">
            {logs.map((log) => (
              <p key={log.id} className={`log-entry ${getLogColor(log.type)} leading-relaxed`}>
                {log.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Output Files (Searcher only) */}
      {mode === 'searcher' && (
        <div className="neon-border rounded-xl glass-panel p-4 min-h-[80px]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Output Files</span>
            {foundResults.length > 0 && (
              <button onClick={handleDownload}
                className="neon-button px-4 py-1.5 rounded-lg text-xs font-medium text-foreground flex items-center gap-1.5">
                <Download className="w-3 h-3" /> Download All
              </button>
            )}
          </div>
          {outputFiles.length === 0 ? (
            <p className="text-muted-foreground/50 text-xs text-center py-3">No output files yet...</p>
          ) : (
            <div className="space-y-2">
              {outputFiles.map((fileName, index) => (
                <div key={index} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/20">
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span className="text-foreground text-xs font-mono truncate">{fileName}</span>
                  <span className="text-muted-foreground text-[10px] ml-auto">{foundResults.length} entries</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-center pt-2 pb-4">
        <p className="text-muted-foreground/40 text-[10px] font-mono tracking-wider">
          POWERED BY @BLACKCODEHAT
        </p>
      </div>
    </div>
  );
};

export default CodmChecker;
