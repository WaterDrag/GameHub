// ─────────────────────────────────────────────────────────────
//  Kdo jsem – dvě cesty, obě vedou k uid, kterému server věří.
//
//   host     – server vydá podepsaný device token, uloží se sem
//              do localStorage. Žádná registrace, hraješ hned.
//   firebase – dobrovolný trvalý profil (Google / e-mail).
//
//  Token je jen doklad totožnosti. Podepisuje ho server svým
//  klíčem, takže si ho v konzoli nikdo nepředělá na cizí uid.
// ─────────────────────────────────────────────────────────────
const K = { MODE: 'gh_mode', TOKEN: 'gh_device', NICK: 'gh_nick' };

export const Identity = {
  get mode() { return localStorage.getItem(K.MODE); },        // 'guest' | 'firebase' | null
  set mode(v) { v ? localStorage.setItem(K.MODE, v) : localStorage.removeItem(K.MODE); },

  get token() { return localStorage.getItem(K.TOKEN) || ''; },
  set token(v) { if (v) localStorage.setItem(K.TOKEN, v); },

  get nick() { return localStorage.getItem(K.NICK) || ''; },
  set nick(v) { localStorage.setItem(K.NICK, v); },

  // Prázdný token = "vydej mi nový", server ho pošle ve WELCOME.
  guestProvider() { return async () => this.token; },

  forget() {
    localStorage.removeItem(K.MODE);
    localStorage.removeItem(K.TOKEN);
  },
};
