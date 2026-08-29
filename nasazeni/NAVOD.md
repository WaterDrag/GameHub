# Nasazení na Oracle Cloud (Always Free)

Cíl: hra běží pořád, i když máš vypnutý počítač, a nestojí nic.

Počítej s hodinou práce. Nejvíc času sežere zakládání účtu u Oracle
a jejich firewall — na ten si dej pozor, viz krok 5, je to nejčastější
místo, kde to lidem přestane fungovat bez zjevného důvodu.

---

## 1. Stroj u Oracle

Založ si účet na <https://cloud.oracle.com> a vytvoř instanci:

- **Shape:** `VM.Standard.A1.Flex` (ARM Ampere) — 1 OCPU a 6 GB bohatě stačí
- **Image:** Ubuntu 22.04 nebo 24.04
- **SSH klíč:** nech si vygenerovat a **stáhni privátní klíč**, jinak se
  na stroj nedostaneš

> Oracle při zakládání chce kartu k ověření totožnosti. Z Always Free
> zdrojů se neúčtuje nic, ale karta být musí.
>
> Kapacita ARM strojů bývá v některých regionech vyčerpaná a vyhodí to
> „Out of host capacity". Buď zkus jiný region, nebo to opakuj později —
> uvolňuje se to průběžně.

Poznamenej si veřejnou IP adresu instance.

## 2. Adresa zdarma

Certifikát nejde vystavit na holou IP, takže potřebuješ jméno.
Na <https://www.duckdns.org> se přihlas přes Google, zadej si název
(např. `mujgamehub`) a do pole IP dej veřejnou IP instance.

Máš `vgamehub.duckdns.org`. Zdarma a napořád.

## 3. Připojení a základní výbava

```bash
ssh -i cesta/k/privatnimu.klici ubuntu@TVOJE_IP

sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
node -v          # musí být 20 nebo víc
```

## 4. Aplikace

```bash
git clone https://github.com/TVUJ_UCET/gamehub.git ~/gamehub
cd ~/gamehub
npm ci --omit=dev
```

Podpisový klíč pro hostovské identity — **bez něj se všem hostům po
každém restartu resetuje identita**:

```bash
printf 'GH_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee /etc/gamehub.env > /dev/null
sudo chmod 600 /etc/gamehub.env
```

(`> /dev/null` je schválně – klíč se tím nevypíše na obrazovku.)

Služba, která server drží nahoře a nastartuje ho i po restartu stroje:

```bash
sudo cp ~/gamehub/nasazeni/gamehub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gamehub
systemctl status gamehub          # musí být "active (running)"
curl -s localhost:3000 | head -3  # musí vypadat jako HTML
```

## 5. Firewall — tady to obvykle přestane fungovat

Oracle má **dva firewally nad sebou** a musíš otevřít oba. Když otevřeš
jen jeden, stroj mlčí a nedá ti vědět proč.

**a) V konzoli Oracle** (Networking → Virtual Cloud Networks → tvoje VCN →
Security Lists → Default): přidej Ingress Rules

| Source | Protokol | Port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**b) Na samotném stroji** — Ubuntu od Oracle má přísná pravidla iptables:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt install -y iptables-persistent    # při dotazu potvrď uložení
sudo netfilter-persistent save
```

## 6. HTTPS

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp ~/gamehub/nasazeni/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy si certifikát vyzvedne sám během pár vteřin. Otevři
`https://vgamehub.duckdns.org` a hra musí naskočit.

## 7. Firebase

Aby fungovalo přihlášení přes Google (hraní jako host jede i bez toho):
Firebase konzole → Authentication → Settings → **Authorized domains** →
přidej `vgamehub.duckdns.org`.

---

## Aktualizace hry

```bash
cd ~/gamehub && git pull && npm ci --omit=dev && sudo systemctl restart gamehub
```

## Když něco nefunguje

| Co vidíš | Kde hledat |
|---|---|
| Stránka se vůbec nenačte | firewall — **oba** podle kroku 5 |
| „Připojuji…" a nic | běží server? `systemctl status gamehub` |
| Neplatný certifikát | míří duckdns na správnou IP? je port 80 otevřený? |
| Hostům mizí identita | chybí `GH_SECRET`, viz krok 4 |
| Chyby v běhu | `journalctl -u gamehub -f` |

## Co do gitu nepatří

`server/.secret` a `/etc/gamehub.env`. První je v `.gitignore`, druhý
žije jen na serveru. Kdyby některý unikl, vyrob nový klíč a restartuj —
staré hostovské tokeny tím přestanou platit.
