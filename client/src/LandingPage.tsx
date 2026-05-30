import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { GAME_MODES, type GameModeId } from './poses';
import { Leaderboard } from './Leaderboard';
import { RankBadge } from './RankBadge';
import type { Friend, FriendRequest } from './friends';
import { supabase, signIn, signUp, signOut, getUsername } from './supabase';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

interface Props {
  onFindPartner: (username: string, mode: GameModeId) => void;
  onTrain: (username: string, mode: GameModeId) => void;
  friends: Friend[];
  friendRequests: FriendRequest[];
  onAddFriend: (username: string) => void;
  onRespondFriend: (from: string, accept: boolean) => void;
  onChallenge: (username: string, mode: GameModeId) => void;
}

type AuthMode = 'login' | 'signup';

export function LandingPage({
  onFindPartner, onTrain, friends, friendRequests, onAddFriend, onRespondFriend, onChallenge,
}: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Auth form state
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Game state (shown after auth)
  const [mode, setMode] = useState<GameModeId>('pushup_repoff');
  const [accountElo, setAccountElo] = useState<number | null>(null);
  const [friendSearch, setFriendSearch] = useState('');

  // Pull the logged-in player's ELO so we can show their rank tier.
  useEffect(() => {
    const name = getUsername(session);
    let cancelled = false;
    (async () => {
      if (!name) { if (!cancelled) setAccountElo(null); return; }
      try {
        const r = await fetch(`${SERVER_URL}/player/${encodeURIComponent(name)}`);
        const d = await r.json();
        if (!cancelled) setAccountElo(d.player?.elo ?? 1000);
      } catch {
        if (!cancelled) setAccountElo(1000);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Restore session on mount and listen for changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async () => {
    setAuthError('');
    const trimmed = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (trimmed.length < 2) {
      setAuthError('Username must be at least 2 characters (letters, numbers, underscores only).');
      return;
    }
    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }
    if (authMode === 'signup' && password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setAuthLoading(true);
    const { error } = authMode === 'signup'
      ? await signUp(trimmed, password)
      : await signIn(trimmed, password);
    setAuthLoading(false);

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        setAuthError('That username is already taken. Try logging in instead.');
      } else if (error.message.includes('Invalid login credentials')) {
        setAuthError('Wrong username or password.');
      } else if (error.message.includes('Email not confirmed')) {
        setAuthError('Check your email to confirm your account — or disable email confirmation in Supabase.');
      } else {
        setAuthError(error.message);
      }
    }
    // On success, onAuthStateChange will fire and setSession
  };

  const handleLogout = async () => {
    await signOut();
    setUsername('');
    setPassword('');
    setConfirmPassword('');
  };

  const submitFriend = () => {
    const name = friendSearch.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (name.length >= 2) {
      onAddFriend(name);
      setFriendSearch('');
    }
  };

  // While checking session, show nothing to avoid flash
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
      </div>
    );
  }

  const loggedInUsername = getUsername(session);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center px-6 py-12">
      {/* Title */}
      <div className="mb-8 select-none text-center">
        <h1 className="text-6xl font-black tracking-tight">
          <span className="text-white">Mogis</span>
          <span className="text-green-400">thenics</span>
        </h1>
        <p className="mt-3 text-zinc-400 text-lg font-medium">
          Omegle for calisthenics. Get matched. Compete. Climb the ranks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-4xl">
        {/* Left: auth or game setup */}
        <div className="flex flex-col gap-5">
          {!session ? (
            /* ── Auth form ─────────────────────────────────────── */
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 flex flex-col gap-4">
              {/* Tab toggle */}
              <div className="flex rounded-xl overflow-hidden border border-zinc-700">
                {(['login', 'signup'] as AuthMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setAuthMode(m); setAuthError(''); }}
                    className={`flex-1 py-2 text-sm font-bold transition-colors ${
                      authMode === m
                        ? 'bg-green-400 text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {m === 'login' ? 'Log In' : 'Create Account'}
                  </button>
                ))}
              </div>

              {/* Username */}
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1 block">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.slice(0, 20))}
                  placeholder="e.g. plank_god"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-xl px-4 py-3 text-white font-semibold placeholder-zinc-600 focus:outline-none focus:border-green-400 transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                />
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-xl px-4 py-3 text-white font-semibold placeholder-zinc-600 focus:outline-none focus:border-green-400 transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                />
              </div>

              {/* Confirm password (signup only) */}
              {authMode === 'signup' && (
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1 block">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-xl px-4 py-3 text-white font-semibold placeholder-zinc-600 focus:outline-none focus:border-green-400 transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  />
                </div>
              )}

              {/* Error */}
              {authError && (
                <p className="text-red-400 text-sm text-center">{authError}</p>
              )}

              {/* Submit */}
              <button
                onClick={handleAuth}
                disabled={authLoading}
                className="bg-green-400 enabled:hover:bg-green-300 disabled:opacity-50 disabled:cursor-not-allowed text-black font-black text-lg px-8 py-3 rounded-xl transition-all duration-150 enabled:active:scale-95"
              >
                {authLoading
                  ? (authMode === 'login' ? 'Logging in…' : 'Creating account…')
                  : (authMode === 'login' ? 'Log In' : 'Create Account')}
              </button>
            </div>
          ) : (
            /* ── Logged in: game setup ──────────────────────────── */
            <>
              {/* Account badge */}
              <div className="flex items-center justify-between bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-zinc-500">Logged in as</p>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-black text-lg">{loggedInUsername}</p>
                    {accountElo !== null && <RankBadge elo={accountElo} showName />}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-zinc-500 hover:text-white text-xs border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Log out
                </button>
              </div>

              {/* Mode select */}
              <div>
                <label className="text-sm font-semibold text-zinc-400 mb-1.5 block">Game mode</label>
                <div className="flex flex-col gap-2">
                  {Object.values(GAME_MODES).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`text-left rounded-xl px-4 py-3 border transition-all ${
                        mode === m.id
                          ? 'bg-green-400/10 border-green-400'
                          : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{m.emoji}</span>
                        <div>
                          <div className="font-bold text-white flex items-center gap-2">
                            {m.name}
                            <span className="text-xs text-zinc-500 font-normal">{m.duration}s</span>
                          </div>
                          <div className="text-xs text-zinc-400">{m.description}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => onFindPartner(loggedInUsername!, mode)}
                className="bg-green-400 hover:bg-green-300 text-black font-black text-xl px-10 py-4 rounded-2xl transition-all duration-150 active:scale-95 shadow-lg shadow-green-400/20"
              >
                Find a Partner →
              </button>
              <button
                onClick={() => onTrain(loggedInUsername!, mode)}
                className="border border-zinc-700 hover:border-green-400 text-zinc-300 hover:text-green-400 font-bold text-base px-10 py-3 rounded-2xl transition-all duration-150 active:scale-95"
              >
                🏋️ Train Solo (no ranking)
              </button>
              <p className="text-zinc-600 text-xs text-center">
                Camera & mic required · Video is peer-to-peer · ELO ranked
              </p>

              {/* ── Friends ─────────────────────────────────────────── */}
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 flex flex-col gap-4">
                <h3 className="font-black text-white text-lg flex items-center gap-2">
                  <span>🧑‍🤝‍🧑</span> Friends
                </h3>

                {/* Add by username */}
                <div className="flex gap-2">
                  <input
                    value={friendSearch}
                    onChange={(e) => setFriendSearch(e.target.value.slice(0, 20))}
                    placeholder="add by username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    onKeyDown={(e) => e.key === 'Enter' && submitFriend()}
                    className="flex-1 bg-zinc-800 border border-zinc-600 rounded-xl px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-400 transition-colors"
                  />
                  <button
                    onClick={submitFriend}
                    className="bg-green-400 hover:bg-green-300 text-black font-bold text-sm px-4 rounded-xl transition-colors"
                  >
                    Add
                  </button>
                </div>

                {/* Incoming requests */}
                {friendRequests.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Requests</p>
                    {friendRequests.map((r) => (
                      <div key={r.username} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-800/60">
                        <span className="flex-1 text-white text-sm font-semibold truncate">{r.username}</span>
                        <button onClick={() => onRespondFriend(r.username, true)}
                          className="text-green-400 hover:text-green-300 text-xs font-bold">Accept</button>
                        <button onClick={() => onRespondFriend(r.username, false)}
                          className="text-zinc-500 hover:text-red-400 text-xs">Decline</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Friends list */}
                <div className="flex flex-col gap-1">
                  {friends.length === 0 && friendRequests.length === 0 && (
                    <p className="text-zinc-600 text-sm text-center py-2">
                      No friends yet — add someone by username.
                    </p>
                  )}
                  {friends.map((f) => (
                    <div key={f.username} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800">
                      <span className={`w-2 h-2 rounded-full ${f.online ? 'bg-green-400' : 'bg-zinc-600'}`}
                        title={f.online ? 'online' : 'offline'} />
                      <span className="flex-1 text-white text-sm font-semibold truncate">{f.username}</span>
                      <RankBadge elo={f.elo} />
                      <button
                        disabled={!f.online}
                        onClick={() => onChallenge(f.username, mode)}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-green-400/40 text-green-400 enabled:hover:bg-green-400 enabled:hover:text-black"
                      >
                        {f.online ? 'Challenge' : 'Offline'}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-zinc-600 text-[11px] text-center">
                  Challenge sends a live invite in your selected mode above.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Right: leaderboard */}
        <Leaderboard highlightUser={loggedInUsername ?? username.trim()} />
      </div>
    </div>
  );
}
