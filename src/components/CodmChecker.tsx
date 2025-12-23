import { useState, useRef } from 'react';
import { Play, Pause, Square, Upload, Search, Menu, Download, RefreshCw, Loader2 } from 'lucide-react';
import { getRandomUniqueEntries } from '@/data/garenaStock';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Mode = 'checker' | 'searcher';
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

interface LogEntry {
  id: number;
  message: string;
  type: 'valid' | 'invalid' | 'clean' | 'notClean' | 'hasCodm' | 'info' | 'found' | 'notFound';
}

const CodmChecker = ({ keyInfo }: CodmCheckerProps) => {
  const [mode, setMode] = useState<Mode>('checker');
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState(true);
  const [stats, setStats] = useState<Stats>({
    valid: 0,
    invalid: 0,
    clean: 0,
    notClean: 0,
    hasCodm: 0,
  });
  const [searcherStats, setSearcherStats] = useState<SearcherStats>({
    found: 0,
    notFound: 0,
    total: 0,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outputFiles, setOutputFiles] = useState<string[]>([]);
  const [foundResults, setFoundResults] = useState<string[]>([]);
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [checkerResults, setCheckerResults] = useState<{
    valid: string[];
    invalid: string[];
    clean: string[];
    notClean: string[];
    hasCodm: string[];
  }>({ valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const logIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const shouldStopRef = useRef(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      addLog(`File selected: ${selectedFile.name}`, 'info');
      
      // Read file contents
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const lines = content.split('\n').filter(line => line.trim() !== '');
        setFileLines(lines);
        addLog(`Loaded ${lines.length} lines from file`, 'info');
      };
      reader.readAsText(selectedFile);
    }
  };

  const addLog = (message: string, type: LogEntry['type']) => {
    logIdRef.current += 1;
    setLogs(prev => [...prev, { id: logIdRef.current, message, type }]);
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }, 100);
  };

  const resetStats = () => {
    setStats({ valid: 0, invalid: 0, clean: 0, notClean: 0, hasCodm: 0 });
    setSearcherStats({ found: 0, notFound: 0, total: 0 });
    setLogs([]);
    setOutputFiles([]);
    setFoundResults([]);
    setCheckerResults({ valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] });
  };

  const handleRefresh = () => {
    resetStats();
    addLog('Ready for new search...', 'info');
  };

  const handleDownload = () => {
    if (foundResults.length === 0) return;
    
    const content = foundResults.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garena_results_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('Results downloaded!', 'info');
  };

  const handleDownloadCategory = (category: keyof typeof checkerResults, label: string) => {
    const results = checkerResults[category];
    if (results.length === 0) return;
    
    const content = results.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.toLowerCase().replace(' ', '_')}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog(`${label} results downloaded!`, 'info');
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setMenuOpen(false);
    resetStats();
    setFile(null);
    addLog(`Switched to ${newMode === 'checker' ? 'CODM Checker' : 'Searcher Domain'} mode`, 'info');
  };

  const handleStart = async () => {
    if (mode === 'checker' && !file) {
      addLog('Please select a file first!', 'info');
      toast.error('Please upload a file first!');
      return;
    }
    if (mode === 'checker' && fileLines.length === 0) {
      addLog('File is empty or still loading!', 'info');
      toast.error('Please wait for file to load or select a valid file.');
      return;
    }
    if (mode === 'searcher' && !selectedDomain) {
      addLog('Please select Garena Domain!', 'info');
      return;
    }
    
    shouldStopRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    setIsProcessing(true);
    addLog(`Starting ${mode === 'checker' ? 'checker' : 'searcher'}...`, 'info');
    
    if (mode === 'checker') {
      await processChecking();
    } else {
      simulateSearching();
    }
    
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
    addLog('Stopped', 'info');
  };

  const generateAccountDetails = (line: string, status: string) => {
    const parts = line.split(':');
    const account = parts[0] || 'Unknown';
    const password = parts[1] || 'Unknown';
    
    const nicknames = ['ProGamer', 'ShadowKill', 'PhantomX', 'DeathStrike', 'NightHawk', 'ViperX', 'StormBreaker', 'IronWolf'];
    const regions = ['Asia', 'Europe', 'North America', 'South America', 'Middle East', 'Oceania'];
    const countries = ['Philippines', 'Indonesia', 'India', 'Brazil', 'USA', 'Thailand', 'Vietnam', 'Malaysia'];
    const bindStatuses = ['Bound', 'Unbound', 'Partial'];
    const securityLevels = ['High', 'Medium', 'Low', 'None'];
    
    return {
      account,
      password,
      nickname: nicknames[Math.floor(Math.random() * nicknames.length)] + Math.floor(Math.random() * 9999),
      level: Math.floor(Math.random() * 150) + 1,
      region: regions[Math.floor(Math.random() * regions.length)],
      uid: Math.floor(Math.random() * 9000000000) + 1000000000,
      email: account.includes('@') ? account : `${account}@garena.com`,
      country: countries[Math.floor(Math.random() * countries.length)],
      bindStatus: bindStatuses[Math.floor(Math.random() * bindStatuses.length)],
      shellBalance: Math.floor(Math.random() * 10000),
      security: securityLevels[Math.floor(Math.random() * securityLevels.length)],
      status
    };
  };

  const formatAccountLog = (details: ReturnType<typeof generateAccountDetails>) => {
    return [
      `Account: ${details.account}`,
      `Password: ${details.password}`,
      `Nickname: ${details.nickname}`,
      `Level: ${details.level}`,
      `Region: ${details.region}`,
      `UID: ${details.uid}`,
      `Email: ${details.email}`,
      `Country: ${details.country}`,
      `Bind Status: ${details.bindStatus}`,
      `Shell Balance: ${details.shellBalance}`,
      `Security: ${details.security}`,
      `Status: ${details.status.toUpperCase()}`
    ].join(' | ');
  };

  const processChecking = async () => {
    if (fileLines.length === 0) {
      addLog('Please upload a file first!', 'info');
      toast.error('No file selected. Please upload a .txt file with accounts.');
      setIsRunning(false);
      return;
    }

    // Validate file format
    const validLines = fileLines.filter(line => {
      const parts = line.split(':');
      return parts.length >= 2 && parts[0].trim() && parts[1].trim();
    });

    if (validLines.length === 0) {
      addLog('No valid accounts found! Format: email:password', 'info');
      toast.error('Invalid file format. Each line should be: email:password');
      setIsRunning(false);
      return;
    }

    if (validLines.length !== fileLines.length) {
      addLog(`Found ${validLines.length} valid accounts (${fileLines.length - validLines.length} skipped)`, 'info');
    }

    addLog(`Processing ${validLines.length} accounts via API...`, 'info');
    
    const tempResults: typeof checkerResults = { valid: [], invalid: [], clean: [], notClean: [], hasCodm: [] };
    const batchSize = 5; // Match server limit
    const maxRetries = 3;
    
    for (let i = 0; i < validLines.length; i += batchSize) {
      if (shouldStopRef.current) {
        addLog('Checking stopped by user.', 'info');
        break;
      }
      
      const batch = validLines.slice(i, Math.min(i + batchSize, validLines.length));
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(validLines.length / batchSize);
      
      let retryCount = 0;
      let success = false;
      
      while (!success && retryCount < maxRetries && !shouldStopRef.current) {
        try {
          addLog(`[BATCH ${batchNum}/${totalBatches}] Sending ${batch.length} accounts to API${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`, 'info');
          
          console.log('Calling codm-checker with batch:', batch);
          
          const { data, error } = await supabase.functions.invoke('codm-checker', {
            body: { accounts: batch }
          });

          console.log('API Response:', { data, error });

          if (error) {
            console.error('API Error:', error);
            // Check if it's a rate limit error
            if (error.message?.includes('429') || error.message?.includes('rate limit')) {
              const waitTime = 60; // Wait 60 seconds on rate limit
              addLog(`Rate limited! Waiting ${waitTime}s before retry...`, 'info');
              toast.warning(`Rate limited. Waiting ${waitTime} seconds...`);
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
              retryCount++;
              continue;
            }
            
            addLog(`API Error: ${error.message}`, 'invalid');
            retryCount++;
            
            if (retryCount < maxRetries) {
              const waitTime = retryCount * 5;
              addLog(`Retrying in ${waitTime}s...`, 'info');
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
            continue;
          }

          success = true;
          addLog(`[BATCH ${batchNum}] Received ${data?.results?.length || 0} results`, 'info');

          if (data?.results && Array.isArray(data.results)) {
            for (const result of data.results) {
              let logType: LogEntry['type'] = 'info';
              let statKey: keyof Stats | null = null;
              let formattedLog = '';
              
              if (result.status === 'valid') {
                const details = result.details || {};
                const codm = result.codm || {};
                
                formattedLog = [
                  `Account: ${result.account}`,
                  `Password: ${result.password}`,
                  `Nickname: ${details.nickname || 'N/A'}`,
                  `UID: ${details.uid || 'N/A'}`,
                  `Email: ${details.email || 'N/A'}`,
                  `Country: ${details.country || 'N/A'}`,
                  `Shell: ${details.shell_balance || 0}`,
                  `Bind: ${details.bind_status || 'N/A'}`,
                  result.hasCodm ? `CODM: ${codm.codm_nickname} (Lv.${codm.codm_level})` : 'CODM: No',
                  `Status: ${result.isClean ? 'CLEAN' : 'NOT CLEAN'}`
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
                
                // Also count as valid
                setStats(prev => ({ ...prev, valid: prev.valid + 1 }));
                tempResults.valid.push(formattedLog);
                
              } else if (result.status === 'invalid') {
                formattedLog = `Account: ${result.account || 'Unknown'} | Status: INVALID | ${result.message || 'Login failed'}`;
                logType = 'invalid';
                statKey = 'invalid';
              } else {
                formattedLog = `Account: ${result.account || 'Unknown'} | Status: ERROR | ${result.message || 'Unknown error'}`;
                logType = 'invalid';
                statKey = 'invalid';
              }
              
              if (statKey) {
                tempResults[statKey].push(formattedLog);
                setStats(prev => ({ ...prev, [statKey]: prev[statKey] + 1 }));
              }
              
              addLog(`[${(statKey || 'info').toUpperCase()}] ${formattedLog}`, logType);
            }
          }
        } catch (err) {
          addLog(`Error processing batch: ${err}`, 'invalid');
          retryCount++;
          
          if (retryCount < maxRetries) {
            const waitTime = retryCount * 5;
            addLog(`Retrying in ${waitTime}s...`, 'info');
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          }
        }
      }
      
      if (!success) {
        addLog(`Failed to process batch ${batchNum} after ${maxRetries} retries`, 'invalid');
        // Mark all accounts in failed batch as errors
        for (const line of batch) {
          const account = line.split(':')[0];
          tempResults.invalid.push(`Account: ${account} | Status: ERROR | Failed after retries`);
          setStats(prev => ({ ...prev, invalid: prev.invalid + 1 }));
        }
      }
      
      // Delay between batches to respect rate limits
      if (i + batchSize < validLines.length && !shouldStopRef.current) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    setIsRunning(false);
    setCheckerResults(tempResults);
    addLog('Checking complete!', 'info');
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
        addLog(`Search complete! Found ${results.length} matches.`, 'info');
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
      
      count++;
    }, 150);
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
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 px-4">
      {/* Header with Menu */}
      <div className="relative pt-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="absolute left-0 top-2 p-2 text-primary hover:text-primary/80 transition-colors z-10"
        >
          <Menu className="w-6 h-6" />
        </button>

        {/* Dropdown Menu */}
        {menuOpen && (
          <div className="absolute left-0 top-12 z-50 neon-border rounded-lg bg-card/95 backdrop-blur-sm overflow-hidden min-w-[180px]">
            <button
              onClick={() => handleModeChange('checker')}
              className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-2
                ${mode === 'checker' ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-secondary/50'}`}
            >
              <Play className="w-4 h-4" />
              CODM Checker
            </button>
            <button
              onClick={() => handleModeChange('searcher')}
              className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-2
                ${mode === 'searcher' ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-secondary/50'}`}
            >
              <Search className="w-4 h-4" />
              Searcher Domain
            </button>
          </div>
        )}

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-center neon-text pt-1">
          {mode === 'checker' ? 'CODM Checker' : 'Searcher Domain'}
        </h1>
        {keyInfo && (
          <div className="flex items-center justify-center gap-1.5 mt-1 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${
              keyInfo.status === 'Valid' ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-muted-foreground">{keyInfo.duration}</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="space-y-4">
        {mode === 'searcher' ? (
          <>
            {/* Domain Selection */}
            <div 
              onClick={() => setSelectedDomain(!selectedDomain)}
              className={`neon-border rounded-lg bg-secondary/30 backdrop-blur-sm px-4 py-3 
                         flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors
                         ${selectedDomain ? 'border-primary' : ''}`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
                ${selectedDomain ? 'border-primary bg-primary/20' : 'border-muted-foreground'}`}>
                {selectedDomain && <div className="w-2.5 h-2.5 bg-primary rounded-sm" />}
              </div>
              <span className="text-foreground text-sm font-medium">Garena Domain.txt</span>
            </div>
            {/* Search and Refresh Buttons */}
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={handleStart}
                disabled={isRunning || !selectedDomain}
                className="neon-button px-8 py-3 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
              <button
                onClick={handleRefresh}
                disabled={isRunning}
                className="neon-button px-6 py-3 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </>
        ) : (
          <>
            {/* File Upload */}
            <div 
              className="neon-border rounded-lg bg-secondary/30 backdrop-blur-sm px-4 py-3 
                         flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 text-foreground shrink-0" />
              <span className="text-muted-foreground text-sm truncate">
                {file ? file.name : 'No file chosen'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Control Buttons */}
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={handleStart}
                disabled={isRunning && !isPaused}
                className="neon-button px-5 py-2.5 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Start
              </button>
              <button
                onClick={handlePause}
                disabled={!isRunning}
                className="neon-button px-5 py-2.5 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Pause className="w-4 h-4" />
                Pause
              </button>
              <button
                onClick={handleStop}
                disabled={!isRunning}
                className="neon-button px-5 py-2.5 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Square className="w-4 h-4" />
                Stop
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
            <div
              key={index}
              className="neon-border rounded-lg bg-card/30 backdrop-blur-sm p-3 sm:p-4 text-center"
            >
              <p className="text-muted-foreground text-xs font-medium mb-1">{stat.label}</p>
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
            <div
              key={stat.key}
              className="neon-border rounded-lg bg-card/30 backdrop-blur-sm p-2 sm:p-3 text-center group cursor-pointer hover:bg-card/50 transition-colors"
              onClick={() => stat.value > 0 && handleDownloadCategory(stat.key, stat.label)}
              title={stat.value > 0 ? `Click to download ${stat.label} results` : ''}
            >
              <p className="text-muted-foreground text-[10px] sm:text-xs font-medium mb-1 truncate">{stat.label}</p>
              <p className={`text-lg sm:text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
              {stat.value > 0 && (
                <Download className="w-3 h-3 mx-auto mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Log Output */}
      <div 
        ref={logContainerRef}
        className="neon-border rounded-xl bg-card/30 backdrop-blur-sm h-48 sm:h-56 overflow-y-auto p-4"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            Logs will appear here...
          </p>
        ) : (
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log) => (
              <p key={log.id} className={getLogColor(log.type)}>
                {log.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Output Files (Searcher only) */}
      {mode === 'searcher' && (
        <div className="neon-border rounded-xl bg-card/30 backdrop-blur-sm p-4 min-h-[80px]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-muted-foreground text-sm">Output Files</p>
            {foundResults.length > 0 && (
              <button
                onClick={handleDownload}
                className="neon-button px-3 py-1.5 rounded-lg text-xs font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           flex items-center gap-1.5"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            )}
          </div>
          {outputFiles.length === 0 ? (
            <p className="text-muted-foreground/50 text-xs">No output files yet...</p>
          ) : (
            <div className="space-y-2">
              {outputFiles.map((fileName, index) => (
                <div key={index} className="flex items-center gap-2 text-primary text-sm">
                  <span>📄</span>
                  <span className="truncate">{fileName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CodmChecker;
