import { useEffect, useRef, useState } from 'react';
import { detectPose, drawPose } from './poseDetector';
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
  onPoseResult?: (result: PoseLandmarkerResult) => void;
}

export function VideoFeed({
  stream, label, primaryValue, primaryLabel, secondaryValue, secondaryLabel,
  secondaryIsScore, isLocal, videoStatus, onPoseResult,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimestamp = useRef<number>(0);
  const cbRef = useRef(onPoseResult);
  const [muted, setMuted] = useState(true);
  useEffect(() => { cbRef.current = onPoseResult; }, [onPoseResult]);

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
          drawPose(canvas, result, video.videoWidth || 640, video.videoHeight || 480);
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
