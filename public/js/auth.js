// ─────────────────────────────────────────────────────────────
//  Firebase Auth – jediné, k čemu Firebase v novém Hubu je.
//  Herní stav i validace běží na vlastním serveru.
// ─────────────────────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';

// Tyhle hodnoty jsou veřejné – jdou do prohlížeče každému návštěvníkovi.
// Přístup nehlídá jejich utajení, ale pravidla na straně Firebase.
export const firebaseConfig = {
  apiKey: 'AIzaSyAIrCxuBDAph7pE6wvDMq6TWNlxaJ_Q-1k',
  authDomain: 'gamehub-v2.firebaseapp.com',
  projectId: 'gamehub-v2',
  storageBucket: 'gamehub-v2.firebasestorage.app',
  messagingSenderId: '934042913839',
  appId: '1:934042913839:web:1ac560ec46874276b88ada',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const google = new GoogleAuthProvider();

export const ADMIN_EMAIL = 'zitkatomik007@gmail.com';

export function onUser(fn) { return onAuthStateChanged(auth, fn); }

export const login = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const loginGoogle = () => signInWithPopup(auth, google);
export const logout = () => signOut(auth);

export async function register(email, pass) {
  const res = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(res.user, { displayName: email.split('@')[0] });
  return res;
}

export async function setNick(nick) {
  if (!auth.currentUser) return;
  await updateProfile(auth.currentUser, { displayName: nick });
  localStorage.setItem('gh_nick', nick);
}

// Server chce čerstvý token při každém (re)connectu.
export async function idToken() {
  if (!auth.currentUser) throw new Error('Nejsi přihlášený.');
  return auth.currentUser.getIdToken();
}

export function displayName() {
  const u = auth.currentUser;
  if (!u) return 'Hráč';
  if (u.isAnonymous) return localStorage.getItem('gh_nick') || 'Host';
  return u.displayName || u.email?.split('@')[0] || 'Hráč';
}
