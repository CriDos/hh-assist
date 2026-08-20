import { create } from 'zustand';
import { SessionData } from '../types/session';
import { send } from '../services/extension';

interface SessionState {
  session: SessionData | null;
  loading: boolean;
  setSession: (session: SessionData | null) => void;
  checkSession: () => Promise<void>;
}

export const useSessionStore = create<SessionState>(set => ({
  session: null,
  loading: true,
  setSession: session => set({ session, loading: false }),
  checkSession: async () => {
    try {
      const session = await send<SessionData>({ type: 'hh:check' });
      if (session) {
        set({ session, loading: false });
      }
    } catch {
      set({ session: { error: true }, loading: false });
    }
  }
}));
