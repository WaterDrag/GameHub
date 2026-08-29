// ─────────────────────────────────────────────────────────────
//  Identita hráče.
//
//  Server potřebuje uid, kterému může věřit – jinak by si kdokoliv
//  mohl nárokovat cizí místo v rozehrané hře (returner systém se
//  řídí právě podle uid). Podporujeme tři způsoby:
//
//   1. device token  – "hraju hned", podepsaný HMAC serveru,
//                      žádná registrace, uloží se v localStorage
//   2. Firebase ID   – dobrovolný trvalý profil, podpis ověřen
//                      proti veřejnému JWKS Googlu
//   3. dev:Jmeno     – jen localhost + GH_DEV_AUTH=1, na testování
//
//  Zbytek serveru o tom nic neví, dostane jen {uid, name, guest}.
// ─────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Musí sedět s projectId v public/js/auth.js – server podle něj kontroluje
// issuer i audience tokenu. Nesoulad = každý Firebase login je odmítnutý.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gamehub-v2';

// Pozor na cestu: je to /jwk/ (jednotné číslo). /jwks/ vrací 404 a projeví
// se to až jako "Expected 200 OK from the JSON Web Key Set HTTP response"
// při prvním skutečném Firebase přihlášení.
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// ── Podpisový klíč ───────────────────────────────────────────
// Drží se v souboru, aby hostům po restartu serveru nezmizela
// identita. Na efemérním hostingu (bez disku) nastav GH_SECRET.
function loadSecret() {
  if (process.env.GH_SECRET) return process.env.GH_SECRET;
  const file = path.join(__dirname, '.secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* první spuštění */ }
  const fresh = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, fresh, { mode: 0o600 }); }
  catch { console.warn('⚠ Nelze uložit .secret – hosté ztratí identitu po restartu. Nastav GH_SECRET.'); }
  return fresh;
}
const SECRET = loadSecret();

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueGuestToken(id = crypto.randomUUID()) {
  const payload = Buffer.from(JSON.stringify({ id, iat: Date.now() })).toString('base64url');
  return `guest.${payload}.${sign(payload)}`;
}

function verifyGuestToken(token) {
  const [kind, payload, sig] = token.split('.');
  if (kind !== 'guest' || !payload || !sig) return null;
  const expect = sign(payload);
  // délky musí sedět, jinak timingSafeEqual hodí výjimku
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { return null; }
}

// ── Dev režim ────────────────────────────────────────────────
// Jen s GH_DEV_AUTH=1 a jen pro spojení z localhostu – i kdyby
// zůstal omylem zapnutý v produkci, zvenčí se přes něj nikdo nedostane.
export const DEV_AUTH = process.env.GH_DEV_AUTH === '1';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
export const isLocal = (addr) => LOCAL.has(String(addr || ''));

// ── Hlavní vstupní bod ───────────────────────────────────────
// Vrací {uid, name, guest} a volitelně `issued` = nový device token,
// který si má klient uložit.
export async function identify({ token = '', name = '' }, remoteAddr = null) {
  token = String(token || '');

  if (DEV_AUTH && token.startsWith('dev:') && isLocal(remoteAddr)) {
    const n = token.slice(4).trim().slice(0, 16) || 'Dev';
    return { uid: `dev:${n.toLowerCase()}`, name: n, guest: true };
  }

  if (token.startsWith('guest.')) {
    const p = verifyGuestToken(token);
    if (p?.id) return { uid: `guest:${p.id}`, name: name || 'Host', guest: true };
    // Neplatný nebo starý podpis (např. po výměně klíče) – místo
    // tvrdého odmítnutí prostě vydáme novou identitu.
  }

  if (!token || token.startsWith('guest.')) {
    const issued = issueGuestToken();
    const p = verifyGuestToken(issued);
    return { uid: `guest:${p.id}`, name: name || 'Host', guest: true, issued };
  }

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  if (!payload.sub) throw new Error('token bez sub');
  return {
    uid: payload.sub,
    name: name || payload.name || payload.email?.split('@')[0] || 'Hráč',
    email: payload.email || null,
    guest: payload.firebase?.sign_in_provider === 'anonymous',
  };
}

export { PROJECT_ID };
