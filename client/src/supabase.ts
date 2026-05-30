import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Supabase Auth requires an email. We hide this from users by constructing
// a synthetic email from their chosen username. Users only ever see/type
// their username — the email is never shown.
export const usernameToEmail = (username: string) =>
  `${username.toLowerCase()}@mogisthenics.app`;

export async function signUp(username: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    options: { data: { username } },
  });
  return { data, error };
}

export async function signIn(username: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  return { data, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Get the display username from an active session.
export function getUsername(session: { user: { user_metadata?: { username?: string } } } | null): string | null {
  return session?.user?.user_metadata?.username ?? null;
}
