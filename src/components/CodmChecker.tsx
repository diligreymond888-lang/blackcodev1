import { useState, useRef } from 'react';
import { Play, Pause, Square, Upload } from 'lucide-react';

interface Stats {
  valid: number;
  invalid: number;
  clean: number;
  notClean: number;
  hasCodm: number;
}

interface LogEntry {
  id: number;
  message: string;
  type: 'valid' | 'invalid' | 'clean' | 'notClean' | 'hasCodm' | 'info';
}

const CodmChecker = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stats, setStats] = useState<Stats>({
    valid: 0,
    invalid: 0,
    clean: 0,
    notClean: 0,
    hasCodm: 0,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
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

  const handleStart = () => {
    if (!file) {
      addLog('Please select a file first!', 'info');
      return;
    }
    setIsRunning(true);
    setIsPaused(false);
    addLog('Starting checker...', 'info');
    // Simulate checking process
    simulateChecking();
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
    // This is a demo simulation - in a real app, this would process the uploaded file
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

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'valid': return 'text-green-400';
      case 'invalid': return 'text-red-400';
      case 'clean': return 'text-blue-400';
      case 'notClean': return 'text-orange-400';
      case 'hasCodm': return 'text-purple-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* File Upload */}
      <div className="flex justify-center">
        <div 
          className="neon-border rounded-lg bg-secondary/30 backdrop-blur-sm px-4 py-2 
                     flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4 text-foreground" />
          <span className="text-muted-foreground text-sm">
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
      </div>

      {/* Control Buttons */}
      <div className="flex justify-center gap-4">
        <button
          onClick={handleStart}
          disabled={isRunning && !isPaused}
          className="neon-button px-6 py-2 rounded-lg font-display text-sm font-medium 
                     text-foreground hover:scale-105 active:scale-95 transition-transform
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Play className="w-4 h-4" />
          Start
        </button>
        <button
          onClick={handlePause}
          disabled={!isRunning}
          className="neon-button px-6 py-2 rounded-lg font-display text-sm font-medium 
                     text-foreground hover:scale-105 active:scale-95 transition-transform
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Pause className="w-4 h-4" />
          Pause
        </button>
        <button
          onClick={handleStop}
          disabled={!isRunning}
          className="neon-button px-6 py-2 rounded-lg font-display text-sm font-medium 
                     text-foreground hover:scale-105 active:scale-95 transition-transform
                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Square className="w-4 h-4" />
          Stop
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Valid', value: stats.valid, color: 'text-green-400' },
          { label: 'Invalid', value: stats.invalid, color: 'text-red-400' },
          { label: 'Clean', value: stats.clean, color: 'text-blue-400' },
          { label: 'Not Clean', value: stats.notClean, color: 'text-orange-400' },
          { label: 'Has CODM', value: stats.hasCodm, color: 'text-purple-400' },
        ].map((stat, index) => (
          <div
            key={index}
            className="neon-border rounded-lg bg-card/30 backdrop-blur-sm p-4 text-center"
          >
            <p className="text-muted-foreground text-xs font-medium mb-1">{stat.label}</p>
            <p className={`text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Log Output */}
      <div 
        ref={logContainerRef}
        className="neon-border rounded-xl bg-card/30 backdrop-blur-sm h-64 overflow-y-auto p-4"
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
    </div>
  );
};

export default CodmChecker;
