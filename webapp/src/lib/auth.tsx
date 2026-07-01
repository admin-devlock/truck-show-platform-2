"use client";

// Auth context. Two identity sources:
//  1. Google sign-in  -> real shared identity (uid/name/photo from Firebase user).
//  2. Guest (DEV ONLY) -> a per-tab throwaway persona for testing collaboration.
//
// Guest mode still signs in anonymously to Firebase so Firestore/Storage rules (which
// require an authenticated request) are satisfied, but the *app identity* is a random
// per-tab id stored in sessionStorage. sessionStorage is per-tab, so opening N tabs
// gives N distinct collaborators in the same browser. Use the dev security rules
// (firestore.rules.dev) while testing, since guest ids != the anonymous auth uid.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInAnonymously,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { colorForUid } from "./presence";

export type Identity = {
  uid: string;
  name: string;
  photo: string | null;
  color: string;
  isGuest: boolean;
};

export const GUEST_ENABLED =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_GUEST === "true";

const GUEST_KEY = "ts_guest";

type AuthState = {
  identity: Identity | null;
  user: User | null; // raw Firebase user (for email display etc.)
  loading: boolean;
  signIn: () => Promise<void>;
  signInAsGuest: (name?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  identity: null,
  user: null,
  loading: true,
  signIn: async () => {},
  signInAsGuest: async () => {},
  signOut: async () => {},
});

const ADJ = ["Amber", "Teal", "Coral", "Indigo", "Olive", "Rust", "Slate", "Mint", "Plum", "Sand"];
const ANIMAL = ["Fox", "Otter", "Heron", "Lynx", "Wren", "Bison", "Moth", "Koi", "Ibis", "Hare"];
function randomPersona() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = ANIMAL[Math.floor(Math.random() * ANIMAL.length)];
  return `${a} ${n}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guest, setGuest] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore a per-tab guest persona (survives reloads of the same tab).
    try {
      const raw = sessionStorage.getItem(GUEST_KEY);
      if (raw) setGuest(JSON.parse(raw));
    } catch {}
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    sessionStorage.removeItem(GUEST_KEY);
    setGuest(null);
    await signInWithPopup(auth, googleProvider);
  };

  const signInAsGuest = async (name?: string) => {
    // Ensure an authenticated (anonymous) Firebase session for rule checks.
    if (!auth.currentUser) await signInAnonymously(auth);
    const uid = "guest_" + Math.random().toString(36).slice(2, 10);
    const persona: Identity = {
      uid,
      name: name?.trim() || randomPersona(),
      photo: null,
      color: colorForUid(uid),
      isGuest: true,
    };
    sessionStorage.setItem(GUEST_KEY, JSON.stringify(persona));
    setGuest(persona);
  };

  const signOut = async () => {
    sessionStorage.removeItem(GUEST_KEY);
    setGuest(null);
    await fbSignOut(auth);
  };

  // Effective identity: guest persona wins; otherwise a non-anonymous (Google) user.
  // Memoised so its reference is stable across unrelated re-renders — consumers key
  // effects on it (e.g. usePresence), and a fresh object each render would needlessly
  // tear down + recreate the presence doc, flickering the user's avatar for others.
  const identity = useMemo<Identity | null>(() => {
    if (guest) return guest;
    if (user && !user.isAnonymous) {
      return {
        uid: user.uid,
        name: user.displayName ?? "Anonymous",
        photo: user.photoURL ?? null,
        color: colorForUid(user.uid),
        isGuest: false,
      };
    }
    return null;
  }, [guest, user]);

  return (
    <AuthContext.Provider
      value={{ identity, user, loading, signIn, signInAsGuest, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
