import { useEffect, useState, useRef } from 'react';

interface Props {
  duration: number; // seconds
  running: boolean;
  onEnd: () => void;
}

export function Timer({ duration, running, onEnd }: Props) {
  const [remaining, setRemaining] = useState(duration);
  const endCalledRef = useRef(false);

  useEffect(() => {
    setRemaining(duration);
    endCalledRef.current = false;
  }, [duration]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          if (!endCalledRef.current) {
            endCalledRef.current = true;
            onEnd();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, onEnd]);

  const pct = (remaining / duration) * 100;
  const color =
    remaining > 30 ? '#00ff88' : remaining > 10 ? '#facc15' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" stroke="#27272a" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${2 * Math.PI * 34}`}
          strokeDashoffset={`${2 * Math.PI * 34 * (1 - pct / 100)}`}
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.5s' }}
        />
      </svg>
      <span
        className="text-3xl font-black tabular-nums -mt-14"
        style={{ color }}
      >
        {remaining}
      </span>
      <span className="text-xs text-zinc-400 mt-10">sec</span>
    </div>
  );
}
