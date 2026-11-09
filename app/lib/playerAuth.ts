
import { supabase } from "./supabase";

export async function signInPlayer() {
  // Reuse an existing authenticated session
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (sessionData.session?.user) {
    return sessionData.session.user;
  }

  // Create a new anonymous account only when needed
  const { data, error } =
    await supabase.auth.signInAnonymously();

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Could not create player account.");
  }

  return data.user;
}
