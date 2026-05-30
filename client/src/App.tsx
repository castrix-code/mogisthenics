import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type MediaConnection } from 'peerjs';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { socket, peerOptions, fetchIceServers } from './socket';
import { supabase, getUsername } from './supabase';
import type { Friend, FriendRequest, IncomingChallenge } from './friends';
import { initPoseDetector } from './poseDetector';
import { useRepCounter } from './useRepCounter';
import { usePoseHold } from './usePoseHold';
import { GAME_MODES, getPoseById, POSE_TEMPLATES, type GameModeId } from './poses';
import { LandingPage } from './LandingPage';
import { VideoFeed } from './VideoFeed';
import { Timer } from './Timer';
import { PoseGuide } from './PoseGuide';
import { ResultModal, type RoundResult } from './ResultModal';

type AppState = 'landing' | 'waiting' | 'in_round' | 'result';

const POSE_IDS = POSE_TEMPLATES.map((p) => p.id);

// Local (no-server) coaching line for solo practice rounds.
function soloTip(mode: GameModeId, score: number): string {
  if (mode === 'pose_hold') {
    return score >= 80
      ? 'Rock-solid hold. Try a harder pose or add a few seconds next time.'
      : 'Find a fixed point to stare at and brace your core to steady the hold.';
  }
  return score >= 25
    ? 'Strong engine! Keep every rep full-depth and your back flat to make them count in ranked.'
    : 'Quality over speed — full range, controlled tempo, hands under shoulders.';
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<GameModeId>('pushup_repoff');
  const [poseId, setPoseId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState('Partner');

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle');
  const [partnerPrimary, setPartnerPrimary] = useState(0);
  const [partnerSecondary, setPartnerSecondary] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [solo, setSolo] = useState(false);
  const soloRef = useRef(false);

  // Lobby / social state
  const [account, setAccount] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [incomingChallenge, setIncomingChallenge] = useState<IncomingChallenge | null>(null);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const appStateRef = useRef<AppState>('landing');
  useEffect(() => { appStateRef.current = appState; }, [appState]);

  // Start the round purely off the Socket.io match signal — the game (timer,
  // reps, live opponent count, scoring) never waits on the WebRTC video, which
  // can fail on strict networks. Video, when it connects, is a bonus overlay.
  const startRound = useCallback(() => {
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
      // Clear any pending challenge UI now that we're in a round.
      setWaitingFor(null);
      setIncomingChallenge(null);

      // Round starts immediately for both players — does NOT wait on video.
      startRound();

      // Best-effort video: the initiator calls; remote stream populates the
      // partner panel if/when it arrives. Failures are shown in the UI.
      setVideoStatus('connecting');
      if (data.initiator && peerRef.current && streamRef.current) {
        const call = peerRef.current.call(data.partnerPeerId, streamRef.current);
        call.on('stream', (s) => { setRemoteStream(s); setVideoStatus('connected'); });
        call.on('error', (err) => { console.error('[PeerJS call error]', err); setVideoStatus('failed'); });
        call.on('close', () => { setRemoteStream(null); });
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

    // Server rejected the join (not logged in / token expired). Tear the
    // session down and return to the landing/login screen.
    socket.on('auth_error', (msg: string) => {
      setTimerRunning(false);
      setRemoteStream(null);
      setResult(null);
      socket.disconnect();
      peerRef.current?.destroy();
      peerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLocalStream(null);
      setAppState('landing');
      if (msg) console.warn('[auth]', msg);
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
      socket.off('auth_error');
      socket.off('partner_left');
    };
  }, [startRound, partnerName]);

  // Briefly surface lobby notices (challenge declined, friend added, etc.)
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Lobby socket: authenticate on connect, keep account in sync ──────────────
  useEffect(() => {
    const authenticate = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (token) socket.emit('authenticate', { token });
    };
    socket.on('connect', authenticate);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const name = getUsername(session);
      setAccount(name);
      if (name) {
        if (!socket.connected) socket.connect();
        else void authenticate();
      } else {
        setFriends([]);
        setFriendRequests([]);
        if (socket.connected) socket.disconnect();
      }
    });

    // Initial: if already logged in on load, connect the lobby socket.
    supabase.auth.getSession().then(({ data }) => {
      const name = getUsername(data.session);
      setAccount(name);
      if (name && !socket.connected) socket.connect();
    });

    return () => {
      socket.off('connect', authenticate);
      subscription.unsubscribe();
    };
  }, []);

  // Tear down a pending challenge attempt and return to the lobby with a notice.
  const abortChallenge = useCallback((msg: string) => {
    setWaitingFor(null);
    setRemoteStream(null);
    setVideoStatus('idle');
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    peerRef.current?.destroy();
    peerRef.current = null;
    setLocalStream(null);
    setAppState((s) => (s === 'in_round' || s === 'result' ? s : 'landing'));
    if (msg) setNotice(msg);
  }, []);

  // ── Lobby socket: friends + challenge events ────────────────────────────────
  useEffect(() => {
    socket.on('friends_data', (d: { friends: Friend[]; requests: FriendRequest[] }) => {
      setFriends(d.friends || []);
      setFriendRequests(d.requests || []);
    });
    socket.on('friend_presence', (d: { username: string; online: boolean }) => {
      setFriends((fs) => fs.map((f) => (f.username === d.username ? { ...f, online: d.online } : f)));
    });
    socket.on('friend_request_result', (d: { to: string; status: string }) => {
      const map: Record<string, string> = {
        requested: `Friend request sent to ${d.to}.`,
        accepted: `You and ${d.to} are now friends!`,
        already_friends: `You're already friends with ${d.to}.`,
        not_found: `No player named "${d.to}".`,
        invalid: `That username isn't valid.`,
        error: `Couldn't send request — try again.`,
      };
      setNotice(map[d.status] ?? null);
    });
    socket.on('challenge_received', (d: IncomingChallenge) => {
      // Only accept challenges from the lobby; auto-decline if busy/in a round.
      if (appStateRef.current !== 'landing') {
        socket.emit('challenge_decline', { from: d.from });
        return;
      }
      setIncomingChallenge(d);
    });
    socket.on('challenge_canceled', () => setIncomingChallenge(null));
    socket.on('challenge_declined', (d: { by: string }) => abortChallenge(`${d.by} declined your challenge.`));
    socket.on('challenge_expired', () => abortChallenge('Challenge expired — no response.'));
    socket.on('challenge_failed', (d: { to: string; reason: string }) =>
      abortChallenge(d.reason === 'offline' ? `${d.to} is offline.` : 'Challenge no longer available.')
    );

    return () => {
      socket.off('friends_data');
      socket.off('friend_presence');
      socket.off('friend_request_result');
      socket.off('challenge_received');
      socket.off('challenge_canceled');
      socket.off('challenge_declined');
      socket.off('challenge_expired');
      socket.off('challenge_failed');
    };
    // abortChallenge is stable (useCallback []), so registering once is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the latest live stats in refs so the broadcast interval can read them
  // without depending on React render timing.
  const liveValueRef = useRef(0);
  const liveSecondaryRef = useRef(0);
  useEffect(() => {
    if (mode === 'pushup_repoff') {
      liveValueRef.current = rep.reps;
      liveSecondaryRef.current = rep.formScore;
    } else {
      liveValueRef.current = pose.liveScore;
      liveSecondaryRef.current = pose.finalScore;
    }
  }, [mode, rep.reps, rep.formScore, pose.liveScore, pose.finalScore]);

  // Broadcast live stats to the partner on a steady interval for the whole
  // round — guarantees the opponent's count keeps updating regardless of how
  // often React re-renders.
  useEffect(() => {
    if (appState !== 'in_round' || !timerRunning || solo) return;
    const send = () =>
      socket.emit('live_update', {
        value: liveValueRef.current,
        secondary: liveSecondaryRef.current,
      });
    send();
    const iv = setInterval(send, 300);
    return () => clearInterval(iv);
  }, [appState, timerRunning, solo]);

  // Acquire camera + a ready PeerJS connection, returning our peer id. Shared by
  // random matchmaking and direct friend challenges. Reuses an existing open
  // peer/stream if one is already live.
  const prepareMedia = useCallback(async (): Promise<string> => {
    if (!poseReady) {
      initPoseDetector().then(() => setPoseReady(true)).catch(console.error);
    }
    if (!socket.connected) socket.connect();

    const [stream, iceServers] = await Promise.all([
      streamRef.current
        ? Promise.resolve(streamRef.current)
        : navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      fetchIceServers(),
    ]);
    streamRef.current = stream;
    setLocalStream(stream);

    if (peerRef.current && peerRef.current.id && !peerRef.current.destroyed) {
      return peerRef.current.id;
    }

    const peer = new Peer(peerOptions(iceServers));
    peerRef.current = peer;

    // Non-initiator: answer the call when it comes in.
    peer.on('call', (call: MediaConnection) => {
      call.answer(stream);
      call.on('stream', (s) => { setRemoteStream(s); setVideoStatus('connected'); });
      call.on('error', (err) => { console.error('[PeerJS answer error]', err); setVideoStatus('failed'); });
      call.on('close', () => { setRemoteStream(null); });
    });
    peer.on('error', console.error);

    return new Promise<string>((resolve) => peer.on('open', (peerId) => resolve(peerId)));
  }, [poseReady]);

  const startSession = useCallback(async (name: string, selectedMode: GameModeId) => {
    setUsername(name);
    setMode(selectedMode);
    modeRef.current = selectedMode;
    setSolo(false);
    soloRef.current = false;

    const peerId = await prepareMedia();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    socket.emit('join_queue', { token, username: name, peerId, mode: selectedMode });
  }, [prepareMedia]);

  // ── Friend actions ──────────────────────────────────────────────────────────
  const addFriend = useCallback((name: string) => {
    socket.emit('friend_request', { to: name });
  }, []);

  const respondFriend = useCallback((from: string, accept: boolean) => {
    socket.emit('friend_respond', { from, accept });
  }, []);

  // ── Challenge a friend (live) ─────────────────────────────────────────────────
  const challengeFriend = useCallback(async (friendUsername: string, selectedMode: GameModeId) => {
    if (!account) return;
    setUsername(account);
    setMode(selectedMode);
    modeRef.current = selectedMode;
    setSolo(false);
    soloRef.current = false;
    setWaitingFor(friendUsername);
    setAppState('waiting');
    const peerId = await prepareMedia();
    socket.emit('challenge_friend', { to: friendUsername, mode: selectedMode, peerId });
  }, [account, prepareMedia]);

  const acceptChallenge = useCallback(async () => {
    const inc = incomingChallenge;
    if (!inc || !account) return;
    setIncomingChallenge(null);
    setUsername(account);
    setMode(inc.mode);
    modeRef.current = inc.mode;
    setSolo(false);
    soloRef.current = false;
    setWaitingFor(inc.from);
    setAppState('waiting');
    const peerId = await prepareMedia();
    socket.emit('challenge_accept', { from: inc.from, peerId });
  }, [incomingChallenge, account, prepareMedia]);

  const declineChallenge = useCallback(() => {
    if (incomingChallenge) socket.emit('challenge_decline', { from: incomingChallenge.from });
    setIncomingChallenge(null);
  }, [incomingChallenge]);

  const cancelChallenge = useCallback(() => {
    socket.emit('cancel_challenge');
    abortChallenge('Challenge canceled.');
  }, [abortChallenge]);

  const handleRoundEnd = useCallback(() => {
    setTimerRunning(false);
    // Solo practice: no opponent, no ELO — just show a local summary.
    if (soloRef.current) {
      const score = submitScoreRef.current;
      setResult({
        youWon: true, draw: false,
        myScore: score, partnerScore: 0, partnerName: 'Practice',
        coachingTip: soloTip(modeRef.current, score),
      });
      setAppState('result');
      return;
    }
    socket.emit('submit_score', { score: submitScoreRef.current });
  }, []);

  // ── Solo / Train mode ─────────────────────────────────────────────────────────
  const startTrain = useCallback(async (name: string, selectedMode: GameModeId) => {
    setUsername(name);
    setMode(selectedMode);
    modeRef.current = selectedMode;
    setSolo(true);
    soloRef.current = true;

    if (!poseReady) {
      initPoseDetector().then(() => setPoseReady(true)).catch(console.error);
    }

    // Pose mode: pick a random pose locally (no server to assign one).
    if (selectedMode === 'pose_hold') {
      const p = POSE_IDS[Math.floor(Math.random() * POSE_IDS.length)];
      setPoseId(p);
      poseIdRef.current = p;
    } else {
      setPoseId(null);
      poseIdRef.current = null;
    }

    rep.reset();
    pose.reset();

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    streamRef.current = stream;
    setLocalStream(stream);

    setAppState('in_round');
    setTimerRunning(true);
  }, [poseReady, rep, pose]);

  const handleTrainAgain = useCallback(() => {
    rep.reset();
    pose.reset();
    setResult(null);
    if (modeRef.current === 'pose_hold') {
      const p = POSE_IDS[Math.floor(Math.random() * POSE_IDS.length)];
      setPoseId(p);
      poseIdRef.current = p;
    }
    setAppState('in_round');
    setTimerRunning(true);
  }, [rep, pose]);

  const handleSoloHome = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    rep.reset();
    pose.reset();
    setResult(null);
    setSolo(false);
    soloRef.current = false;
    setTimerRunning(false);
    setAppState('landing');
  }, [rep, pose]);

  const requeue = useCallback(() => {
    rep.reset();
    pose.reset();
    setPartnerPrimary(0);
    setPartnerSecondary(0);
    setRemoteStream(null);
    setVideoStatus('idle');
    setResult(null);
    setTimerRunning(false);
  }, [rep, pose]);

  const handleNext = useCallback(async () => {
    socket.emit('next_partner');
    requeue();
    setAppState('waiting');
    if (peerRef.current?.id) {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      socket.emit('join_queue', { token, username, peerId: peerRef.current.id, mode: modeRef.current });
    }
  }, [requeue, username]);

  const handleHome = useCallback(() => {
    // Leave the match/peer but keep the lobby socket connected so friends,
    // presence, and incoming challenges keep working from the landing page.
    socket.emit('next_partner');
    setWaitingFor(null);
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    requeue();
    setAppState('landing');
    socket.emit('friends_refresh');
  }, [requeue]);

  const handlePoseResult = useCallback((res: PoseLandmarkerResult) => {
    if (!timerRunning) return;
    const lm = res.landmarks[0];
    if (!lm) return;
    if (modeRef.current === 'pushup_repoff') rep.processPose(lm);
    else pose.processPose(lm);
  }, [timerRunning, rep, pose]);

  // Global overlays that can appear over the lobby / waiting screens.
  const noticeToast = notice ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-zinc-800 border border-zinc-600 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-lg">
      {notice}
    </div>
  ) : null;

  const incomingModal = incomingChallenge ? (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] px-4">
      <div className="bg-zinc-900 border border-green-400/40 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="text-5xl mb-3">⚔️</div>
        <h2 className="text-2xl font-black text-white mb-1">{incomingChallenge.from} challenges you!</h2>
        <p className="text-zinc-400 text-sm mb-6">
          {GAME_MODES[incomingChallenge.mode].emoji} {GAME_MODES[incomingChallenge.mode].name}
        </p>
        <div className="flex gap-3">
          <button onClick={declineChallenge}
            className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white font-semibold transition-colors">
            Decline
          </button>
          <button onClick={acceptChallenge}
            className="flex-1 py-3 rounded-xl bg-green-400 hover:bg-green-300 text-black font-black transition-colors">
            Accept ⚔️
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Landing ─────────────────────────────────────────────────────────────────
  if (appState === 'landing') {
    return (
      <>
        <LandingPage
          onFindPartner={startSession}
          onTrain={startTrain}
          friends={friends}
          friendRequests={friendRequests}
          onAddFriend={addFriend}
          onRespondFriend={respondFriend}
          onChallenge={challengeFriend}
        />
        {incomingModal}
        {noticeToast}
      </>
    );
  }

  // ── Waiting ─────────────────────────────────────────────────────────────────
  if (appState === 'waiting') {
    const isChallenge = !!waitingFor;
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
        <p className="text-white text-xl font-bold">
          {isChallenge ? `Waiting for ${waitingFor} to accept…` : 'Finding a partner…'}
        </p>
        <p className="text-zinc-500 text-sm">
          {GAME_MODES[mode].emoji} {GAME_MODES[mode].name} · get ready!
        </p>
        <button onClick={isChallenge ? cancelChallenge : handleHome}
          className="mt-4 text-zinc-600 hover:text-zinc-400 text-sm underline">
          Cancel
        </button>
        {noticeToast}
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
          {solo && <span className="text-xs text-green-400 font-semibold">🏋️ Practice</span>}
          <button onClick={solo ? handleSoloHome : handleHome}
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
          showFormOverlay={mode === 'pushup_repoff'}
          onPoseResult={handlePoseResult}
        />

        {isPose && template && (
          <PoseGuide pose={template} liveScore={pose.liveScore} perCheck={pose.perCheck} />
        )}

        {!solo && (
          <VideoFeed
            stream={remoteStream}
            label={partnerName}
            primaryValue={partnerPrimary}
            primaryLabel={myPrimaryLabel}
            secondaryValue={partnerSecondary}
            secondaryLabel={mySecondaryLabel}
            secondaryIsScore
            videoStatus={videoStatus}
          />
        )}
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
          solo={solo}
          onNext={solo ? handleTrainAgain : handleNext}
          onHome={solo ? handleSoloHome : handleHome}
        />
      )}

      {/* keep leaderboard fresh after a match */}
      <span className="hidden">{leaderboardKey}</span>
    </div>
  );
}
