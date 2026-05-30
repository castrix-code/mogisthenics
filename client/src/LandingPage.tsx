import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { GAME_MODES, type GameModeId } from './poses';
import { Leaderboard } from './Leaderboard';
import { supabase, signIn, signUp, signOut, getUsername } from './supabase';

interface Props {
  onFindPartner: (username: string, mode: GameModeId) => void;
}

type AuthMode = 'login' | 'signup';

export function LandingPage({ onFindPartner }: Props) {
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
                  <p className="text-white font-black text-lg">{loggedInUsername}</p>
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
              <p className="text-zinc-600 text-xs text-center">
                Camera & mic required · Video is peer-to-peer · ELO ranked
              </p>
            </>
          )}
        </div>

        {/* Right: leaderboard */}
        <Leaderboard highlightUser={loggedInUsername ?? username.trim()} />
      </div>
    </div>
  );
}
