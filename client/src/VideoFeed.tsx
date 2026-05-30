import { useEffect, useRef, useState } from 'react';
import { detectPose, drawPose, calcPushupMetrics, pushupCue, type PushupCue } from './poseDetector';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';

interface Props {
  stream: MediaStream | null;
  label: string;
  primaryValue: number;
  primaryLabel: string;
  secondaryValue: number;
  secondaryLabel: string;
  secondaryIsScore?: boolean; // color-code 0-100
  isLocal?: boolean;
  videoStatus?: 'idle' | 'connecting' | 'connected' | 'failed';
  showFormOverlay?: boolean; // live pushup coaching HUD (local + pushup mode)
  onPoseResult?: (result: PoseLandmarkerResult) => void;
}

type FormHud = { cue: PushupCue; depth: number; angle: number };

const TONE_CLASS: Record<PushupCue['tone'], string> = {
  idle: 'bg-zinc-700 text-white',
  down: 'bg-sky-500 text-white',
  up: 'bg-green-400 text-black',
  invalid: 'bg-amber-500 text-black',
};

export function VideoFeed({
  stream, label, primaryValue, primaryLabel, secondaryValue, secondaryLabel,
  secondaryIsScore, isLocal, videoStatus, showFormOverlay, onPoseResult,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimestamp = useRef<number>(0);
  const cbRef = useRef(onPoseResult);
  const overlayRef = useRef(showFormOverlay);
  const lastHudRef = useRef(0);
  const [muted, setMuted] = useState(true);
  const [hud, setHud] = useState<FormHud | null>(null);
  useEffect(() => { cbRef.current = onPoseResult; }, [onPoseResult]);
  // HUD only renders when showFormOverlay is true, so no need to clear it here.
  useEffect(() => { overlayRef.current = showFormOverlay; }, [showFormOverlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    // Always start muted so Chrome's autoplay policy allows the video to play.
    // For local feed this is correct; for remote the user can unmute via the button.
    video.muted = isLocal ? true : muted;
    video.play().catch(() => {});
  }, [stream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync muted state to video element when user toggles
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isLocal) return;
    video.muted = muted;
  }, [muted, isLocal]);

  // Pose detection loop, local feed only
  useEffect(() => {
    if (!isLocal) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let running = true;

    function loop(ts: number) {
      if (!running || !video || !canvas) return;
      if (video.readyState >= 2 && ts !== lastTimestamp.current) {
        lastTimestamp.current = ts;
        const result = detectPose(video, ts);
        if (result) {
          let color = '#00ff88';
          if (overlayRef.current) {
            const lm = result.landmarks[0];
            const m = lm ? calcPushupMetrics(lm) : null;
            if (m) {
              color = m.valid ? '#00ff88' : '#f59e0b';
              // Throttle HUD state updates to ~12fps to keep re-renders cheap.
              if (ts - lastHudRef.current > 80) {
                lastHudRef.current = ts;
                setHud({ cue: pushupCue(m), depth: m.depth, angle: Math.round(m.elbowAngle) });
              }
            }
          }
          drawPose(canvas, result, video.videoWidth || 640, video.videoHeight || 480, color);
          cbRef.current?.(result);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [isLocal]);

  const scoreColor = (v: number) =>
    v >= 80 ? 'text-green-400' : v >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="relative flex-1 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700 min-h-[300px]">
      {/* muted attr managed via ref to guarantee Chrome autoplay works */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        style={{ transform: isLocal ? 'scaleX(-1)' : undefined }}
      />
      {isLocal && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ transform: 'scaleX(-1)' }}
        />
      )}

      {/* Live pushup form HUD — DOM overlay (not mirrored, so text reads normally) */}
      {isLocal && showFormOverlay && hud && (
        <>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className={`px-4 py-1.5 rounded-full text-sm font-black tracking-wide shadow-lg ${TONE_CLASS[hud.cue.tone]}`}>
              {hud.cue.text}
            </span>
          </div>
          <div className="absolute left-3 top-1/4 bottom-1/4 flex flex-col items-center gap-1 pointer-events-none">
            <span className="text-[10px] font-bold text-zinc-300 bg-black/50 rounded px-1">{hud.angle}°</span>
            <div className="flex-1 w-2.5 rounded-full bg-black/50 overflow-hidden flex flex-col-reverse">
              <div
                className="w-full bg-gradient-to-t from-green-400 to-emerald-300 transition-[height] duration-100"
                style={{ height: `${Math.min(100, Math.max(0, hud.depth))}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-zinc-400 bg-black/50 rounded px-1">depth</span>
          </div>
        </>
      )}
      {!isLocal && stream && (
        <button
          onClick={() => setMuted((m) => !m)}
          className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white text-xs px-2 py-1 rounded-full transition-colors"
        >
          {muted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
      )}
      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
          {isLocal ? (
            <span className="text-zinc-500 text-sm">Starting camera…</span>
          ) : videoStatus === 'failed' ? (
            <>
              <span className="text-2xl">📡</span>
              <span className="text-red-400 text-sm font-semibold">Video blocked by network</span>
              <span className="text-zinc-500 text-xs">Reps still syncing — your network blocks peer video</span>
            </>
          ) : (
            <>
              <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-zinc-300 text-sm font-semibold">{label} is live</span>
              <span className="text-zinc-500 text-xs">
                {videoStatus === 'connecting' ? 'Connecting video…' : 'Waiting for video…'}
              </span>
            </>
          )}
        </div>
      )}

      <div className="absolute top-3 left-3">
        <span className="text-xs font-semibold bg-black/60 text-white px-2 py-0.5 rounded-full">
          {label}
        </span>
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
        <div className="bg-black/70 rounded-lg px-3 py-2">
          <div className="text-3xl font-black text-white leading-none">{primaryValue}</div>
          <div className="text-xs text-zinc-400 mt-0.5">{primaryLabel}</div>
        </div>
        <div className="bg-black/70 rounded-lg px-3 py-2 text-right">
          <div className={`text-2xl font-black leading-none ${secondaryIsScore ? scoreColor(secondaryValue) : 'text-white'}`}>
            {secondaryValue}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">{secondaryLabel}</div>
        </div>
      </div>
    </div>
  );
}
