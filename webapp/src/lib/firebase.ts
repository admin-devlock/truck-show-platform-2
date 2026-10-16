// Firebase client initialisation. The config values are public by design — Firebase
// web apps ship them to the browser; access is gated by Auth + security rules, not
// by hiding these keys.
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// NEXT_PUBLIC_* values are inlined at BUILD time — a docker build that misses a
// --build-arg otherwise fails only at first sign-in with an opaque error. Fail loudly.
{
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Firebase config incomplete — missing ${missing.join(", ")}. ` +
        "Set the NEXT_PUBLIC_FIREBASE_* env vars (or docker build args) and rebuild.",
    );
  }
}

const isNewApp = getApps().length === 0;
const app: FirebaseApp = isNewApp ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
// Explicitly isolated browser testing: never route a production project to emulators.
if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true") {
  if (process.env.NODE_ENV !== "development" || !firebaseConfig.projectId?.startsWith("demo-")) {
    throw new Error("Emulator mode requires development and a demo- project ID.");
  }
  if (isNewApp) {
    connectAuthEmulator(auth, "http://127.0.0.1:9098", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8088);
  }
}
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export default app;
