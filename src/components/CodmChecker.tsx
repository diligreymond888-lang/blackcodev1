import { useState, useRef } from 'react';
import { Play, Pause, Square, Upload, Search, Menu } from 'lucide-react';

type Mode = 'checker' | 'searcher';

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

const CodmChecker = () => {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      addLog(`File selected: ${e.target.files[0].name}`, 'info');
    }
  };

  const addLog = (message: string, type: LogEntry['type']) => {
    setLogs(prev => [...prev, { id: Date.now(), message, type }]);
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
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setMenuOpen(false);
    resetStats();
    setFile(null);
    addLog(`Switched to ${newMode === 'checker' ? 'CODM Checker' : 'ULP Searcher'} mode`, 'info');
  };

  const handleStart = () => {
    if (mode === 'checker' && !file) {
      addLog('Please select a file first!', 'info');
      return;
    }
    if (mode === 'searcher' && !selectedDomain) {
      addLog('Please select Garena Domain!', 'info');
      return;
    }
    if (mode === 'searcher' && !file) {
      addLog('Please select an input file!', 'info');
      return;
    }
    
    setIsRunning(true);
    setIsPaused(false);
    addLog(`Starting ${mode === 'checker' ? 'checker' : 'searcher'}...`, 'info');
    
    if (mode === 'checker') {
      simulateChecking();
    } else {
      simulateSearching();
    }
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
    addLog(isPaused ? 'Resuming...' : 'Paused', 'info');
  };

  const handleStop = () => {
    setIsRunning(false);
    setIsPaused(false);
    addLog('Stopped', 'info');
  };

  const simulateChecking = () => {
    const types: LogEntry['type'][] = ['valid', 'invalid', 'clean', 'notClean', 'hasCodm'];
    let count = 0;
    const maxCount = 10;

    const interval = setInterval(() => {
      if (count >= maxCount) {
        clearInterval(interval);
        setIsRunning(false);
        addLog('Checking complete!', 'info');
        return;
      }

      const randomType = types[Math.floor(Math.random() * types.length)];
      const sampleData = `account${count + 1}@example.com`;
      
      addLog(`[${randomType.toUpperCase()}] ${sampleData}`, randomType);
      
      setStats(prev => ({
        ...prev,
        [randomType]: prev[randomType as keyof Stats] + 1,
      }));
      
      count++;
    }, 500);
  };

  const simulateSearching = () => {
    let count = 0;
    const maxCount = 15;
    const results: string[] = [];

    addLog('Searching in Garena Domain.txt...', 'info');

    const interval = setInterval(() => {
      if (count >= maxCount) {
        clearInterval(interval);
        setIsRunning(false);
        if (results.length > 0) {
          setOutputFiles([`garena_results_${Date.now()}.txt`]);
        }
        addLog(`Search complete! Found ${results.length} matches.`, 'info');
        return;
      }

      const isFound = Math.random() > 0.4;
      const sampleData = `user${count + 1}@garena.com:password${count}`;
      
      if (isFound) {
        results.push(sampleData);
        addLog(`[FOUND] ${sampleData}`, 'found');
        setSearcherStats(prev => ({
          ...prev,
          found: prev.found + 1,
          total: prev.total + 1,
        }));
      } else {
        addLog(`[NOT FOUND] ${sampleData}`, 'notFound');
        setSearcherStats(prev => ({
          ...prev,
          notFound: prev.notFound + 1,
          total: prev.total + 1,
        }));
      }
      
      count++;
    }, 400);
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
              ULP Searcher
            </button>
          </div>
        )}

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-center neon-text pt-1">
          {mode === 'checker' ? 'CODM Checker' : 'ULP Searcher'}
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm text-center mt-1">
          powered by <span className="text-primary">@egoistyato</span>
        </p>
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

            {/* File Upload */}
            <div 
              className="neon-border rounded-lg bg-secondary/30 backdrop-blur-sm px-4 py-3 
                         flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 text-foreground shrink-0" />
              <span className="text-muted-foreground text-sm truncate">
                {file ? file.name : 'Select input file'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Search Button */}
            <div className="flex justify-center pt-2">
              <button
                onClick={handleStart}
                disabled={isRunning || !selectedDomain}
                className="neon-button px-10 py-3 rounded-lg font-display text-sm font-medium 
                           text-foreground hover:scale-105 active:scale-95 transition-transform
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                Search
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
            { label: 'Valid', value: stats.valid, color: 'text-green-400' },
            { label: 'Invalid', value: stats.invalid, color: 'text-red-400' },
            { label: 'Clean', value: stats.clean, color: 'text-blue-400' },
            { label: 'Not Clean', value: stats.notClean, color: 'text-orange-400' },
            { label: 'Has CODM', value: stats.hasCodm, color: 'text-purple-400' },
          ].map((stat, index) => (
            <div
              key={index}
              className="neon-border rounded-lg bg-card/30 backdrop-blur-sm p-2 sm:p-3 text-center"
            >
              <p className="text-muted-foreground text-[10px] sm:text-xs font-medium mb-1 truncate">{stat.label}</p>
              <p className={`text-lg sm:text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
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
          <p className="text-muted-foreground text-sm mb-2">Output Files</p>
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
