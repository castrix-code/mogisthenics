import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type MediaConnection } from 'peerjs';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { socket } from './socket';
import { initPoseDetector } from './poseDetector';
import { useRepCounter } from './useRepCounter';
import { usePoseHold } from './usePoseHold';
import { GAME_MODES, getPoseById, type GameModeId } from './poses';
import { LandingPage } from './LandingPage';
import { VideoFeed } from './VideoFeed';
import { Timer } from './Timer';
import { PoseGuide } from './PoseGuide';
import { ResultModal, type RoundResult } from './ResultModal';

type AppState = 'landing' | 'waiting' | 'in_round' | 'result';

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<GameModeId>('pushup_repoff');
  const [poseId, setPoseId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState('Partner');

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [partnerPrimary, setPartnerPrimary] = useState(0);
  const [partnerSecondary, setPartnerSecondary] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<GameModeId>('pushup_repoff');
  const poseIdRef = useRef<string | null>(null);

  const rep = useRepCounter();
  const pose = usePoseHold(poseId);

  // Keep refs current for use inside socket/timer callbacks
  const submitScoreRef = useRef(0);
  useEffect(() => {
    submitScoreRef.current = mode === 'pushup_repoff' ? rep.reps : pose.finalScore;
  }, [mode, rep.reps, pose.finalScore]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { poseIdRef.current = poseId; }, [poseId]);

  const beginRound = useCallback((remote: MediaStream) => {
    setRemoteStream(remote);
    setAppState('in_round');
    setTimerRunning(true);
  }, []);

  // Socket wiring
  useEffect(() => {
    socket.on('waiting', () => setAppState('waiting'));

    socket.on('matched', (data: {
      mode: GameModeId; pose: string | null; partnerPeerId: string;
      partnerName: string; initiator: boolean;
    }) => {
      setMode(data.mode);
      setPoseId(data.pose);
      setPartnerName(data.partnerName);
      modeRef.current = data.mode;
      poseIdRef.current = data.pose;

      if (data.initiator && peerRef.current && streamRef.current) {
        const call = peerRef.current.call(data.partnerPeerId, streamRef.current);
        call.on('stream', beginRound);
      }
    });

    socket.on('partner_live_update', (d: { value: number; secondary: number }) => {
      setPartnerPrimary(d.value);
      setPartnerSecondary(d.secondary);
    });

    socket.on('round_result', (r: RoundResult) => {
      setTimerRunning(false);
      setResult(r);
      setAppState('result');
      setLeaderboardKey((k) => k + 1);
    });

    socket.on('partner_left', () => {
      setTimerRunning(false);
      setRemoteStream(null);
      setResult({
        youWon: true, draw: false,
        myScore: submitScoreRef.current, partnerScore: 0,
        partnerName, coachingTip: 'Your partner left — automatic win! Keep training.',
      });
      setAppState('result');
    });

    return () => {
      socket.off('waiting');
      socket.off('matched');
      socket.off('partner_live_update');
      socket.off('round_result');
      socket.off('partner_left');
    };
  }, [beginRound, partnerName]);

  // Broadcast live stats to partner
  useEffect(() => {
    if (appState !== 'in_round' || !timerRunning) return;
    if (mode === 'pushup_repoff') {
      socket.emit('live_update', { value: rep.reps, secondary: rep.formScore });
    } else {
      socket.emit('live_update', { value: pose.liveScore, secondary: pose.finalScore });
    }
  }, [appState, timerRunning, mode, rep.reps, rep.formScore, pose.liveScore, pose.finalScore]);

  const startSession = useCallback(async (name: string, selectedMode: GameModeId) => {
    setUsername(name);
    setMode(selectedMode);
    modeRef.current = selectedMode;

    // Spin up MediaPipe only once a session actually begins
    if (!poseReady) {
      initPoseDetector().then(() => setPoseReady(true)).catch(console.error);
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    streamRef.current = stream;
    setLocalStream(stream);

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (peerId) => {
      socket.connect();
      socket.emit('join_queue', { username: name, peerId, mode: selectedMode });
    });

    // Non-initiator answers
    peer.on('call', (call: MediaConnection) => {
      call.answer(stream);
      call.on('stream', beginRound);
    });

    peer.on('error', console.error);
  }, [beginRound]);

  const handleRoundEnd = useCallback(() => {
    setTimerRunning(false);
    socket.emit('submit_score', { score: submitScoreRef.current });
  }, []);

  const requeue = useCallback(() => {
    rep.reset();
    pose.reset();
    setPartnerPrimary(0);
    setPartnerSecondary(0);
    setRemoteStream(null);
    setResult(null);
    setTimerRunning(false);
  }, [rep, pose]);

  const handleNext = useCallback(() => {
    socket.emit('next_partner');
    requeue();
    setAppState('waiting');
    if (peerRef.current?.id) {
      socket.emit('join_queue', { username, peerId: peerRef.current.id, mode: modeRef.current });
    }
  }, [requeue, username]);

  const handleHome = useCallback(() => {
    socket.emit('next_partner');
    socket.disconnect();
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    requeue();
    setAppState('landing');
  }, [requeue]);

  const handlePoseResult = useCallback((res: PoseLandmarkerResult) => {
    if (!timerRunning) return;
    const lm = res.landmarks[0];
    if (!lm) return;
    if (modeRef.current === 'pushup_repoff') rep.processPose(lm);
    else pose.processPose(lm);
  }, [timerRunning, rep, pose]);

  // ── Landing ─────────────────────────────────────────────────────────────────
  if (appState === 'landing') {
    return <LandingPage onFindPartner={startSession} />;
  }

  // ── Waiting ─────────────────────────────────────────────────────────────────
  if (appState === 'waiting') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-6 text-center">
        {localStream && (
          <div className="w-48 h-36 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700 mb-2">
            <video
              autoPlay muted playsInline
              ref={(el) => { if (el) el.srcObject = localStream; }}
              className="w-full h-full object-cover scale-x-[-1]"
            />
          </div>
        )}
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-3 h-3 rounded-full bg-green-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="text-white text-xl font-bold">Finding a partner…</p>
        <p className="text-zinc-500 text-sm">
          {GAME_MODES[mode].emoji} {GAME_MODES[mode].name} · get ready!
        </p>
        <button onClick={handleHome} className="mt-4 text-zinc-600 hover:text-zinc-400 text-sm underline">
          Cancel
        </button>
      </div>
    );
  }

  // ── In round / result ─────────────────────────────────────────────────────────
  const m = GAME_MODES[mode];
  const isPose = mode === 'pose_hold';
  const template = poseId ? getPoseById(poseId) : undefined;

  const myPrimary = isPose ? pose.liveScore : rep.reps;
  const myPrimaryLabel = isPose ? 'match' : 'reps';
  const mySecondary = isPose ? pose.finalScore : rep.formScore;
  const mySecondaryLabel = isPose ? 'avg' : 'form';

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-black">
            <span className="text-white">Mogis</span><span className="text-green-400">thenics</span>
          </h1>
          <span className="text-xs text-zinc-500">{m.emoji} {m.name}</span>
        </div>

        <Timer duration={m.duration} running={timerRunning} onEnd={handleRoundEnd} />

        <div className="flex items-center gap-3">
          {!poseReady && <span className="text-xs text-yellow-400 animate-pulse">Loading AI…</span>}
          <button onClick={handleHome}
            className="text-zinc-500 hover:text-white text-sm border border-zinc-700 rounded-lg px-3 py-1.5 transition-colors">
            Quit
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 p-4">
        <VideoFeed
          stream={localStream}
          label={`${username} (you)`}
          primaryValue={myPrimary}
          primaryLabel={myPrimaryLabel}
          secondaryValue={mySecondary}
          secondaryLabel={mySecondaryLabel}
          secondaryIsScore
          isLocal
          onPoseResult={handlePoseResult}
        />

        {isPose && template && (
          <PoseGuide pose={template} liveScore={pose.liveScore} perCheck={pose.perCheck} />
        )}

        <VideoFeed
          stream={remoteStream}
          label={partnerName}
          primaryValue={partnerPrimary}
          primaryLabel={myPrimaryLabel}
          secondaryValue={partnerSecondary}
          secondaryLabel={mySecondaryLabel}
          secondaryIsScore
        />
      </div>

      <div className="px-6 py-3 border-t border-zinc-800 flex justify-center">
        <span className="text-zinc-600 text-xs">
          {timerRunning
            ? (isPose ? `🔴 Hold the ${template?.name}!` : '🔴 Round in progress — do pushups!')
            : '⏸ Waiting…'}
        </span>
      </div>

      {appState === 'result' && result && (
        <ResultModal
          result={result}
          scoreLabel={isPose ? 'match' : 'reps'}
          onNext={handleNext}
          onHome={handleHome}
        />
      )}

      {/* keep leaderboard fresh after a match */}
      <span className="hidden">{leaderboardKey}</span>
    </div>
  );
}
