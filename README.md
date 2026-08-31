# Game Hub 2.0

Autoritativní herní server + Pixi klient. Náhrada starého hubu, kde se hry
vkládaly jako HTML text do Firestore a běžely v `iframe srcdoc`.

## Proč to je postavené jinak

Starý hub měl jednu zásadní vlastnost: **celá hra běžela v prohlížeči hráče**.
Cokoliv sis otevřel v konzoli a přepsal (HP, pozice, skóre), bylo pravda —
protože nikdo jiný pravdu neznal.

Tady je to obráceně:

```
        klient                          server
   ┌──────────────┐               ┌────────────────────┐
   │ Pixi render  │ ── vstupy ──▶ │ herní modul        │
   │ (jen kreslí) │               │  · validace tahů   │
   │              │ ◀── pohled ── │  · simulace        │
   └──────────────┘               │  · boti            │
                                  │  · RNG (kostky…)   │
                                  └────────────────────┘
```

Klient posílá **výhradně vstupy** ("chci hrát na 7,7", "držím W a mířím sem").
Nikdy neposílá stav. Server je jediný zdroj pravdy a každý vstup si sám ověří.
Kdo si v konzoli přepíše `board`, uvidí svoji lež přesně do dalšího snapshotu.

Ověřeno v praxi — podvržená deska se přepsala zpátky do 250 ms a nelegální tahy
server odmítl s `Obsazeno.` / `Mimo desku.` / `Nejsi na tahu.`

## Co je hotové

| Věc | Stav |
|---|---|
| Autoritativní server (Node + `ws`) | ✅ |
| Hraní bez registrace přes podepsaný device token | ✅ |
| Volitelný Firebase login (Google / e-mail) pro trvalý profil | ✅ |
| Místnosti, kódy, veřejný seznam, rychlá hra, chat | ✅ |
| **Returner systém** — návrat do rozehrané hry i po refreshi | ✅ |
| **Převzetí botem** — po odpojení i po 2 min nečinnosti, s hláškou a odznakem | ✅ |
| Boti jako plnohodnotní hráči (3 obtížnosti) | ✅ |
| Pixi (WebGL) renderer | ✅ |
| 6 motivů vzhledu, propisují se i do herní plochy | ✅ |
| Hub s filtry, hledáním (bez ohledu na diakritiku) a živými statistikami | ✅ |
| Rate limit, ochrana proti path traversal, sanitizace jmen a chatu | ✅ |
| Piškvorky 15×15 (skutečné ✕ a ◯) | ✅ |
| **Aréna** – real-time deathmatch s predikcí, interpolací a boty | ✅ |
| **Dostihy a sázky** – celá pravidla na serveru, obchodování, boti | ✅ |
| **Závody** – okruh shora, predikce řízení, kontrolní body, boti | ✅ |
| **Stavěná trať** – hráči ji skládají z dílků a sázejí do ní pasti | ✅ |
| **Šachy** – celá pravidla ověřená perftem, bot s alfa-beta | ✅ |
| **Člověče, nezlob se** – pravidla z předlohy, deska pro 4 i pro 8 hráčů | ✅ |
| **UNO No Mercy** – 136 karet, oficiální pravidla, tajné ruce | ✅ |
| **Osadníci z Katanu** – celá pravidla, tajné ruce, obchod mezi hráči | ✅ |
| Volby před hrou se mění i v čekárně a hra si je umí zamknout | ✅ |

## Netcode arény

Real-time hra přes internet má neřešitelný problém: než tvůj stisk klávesy
doletí na server a odpověď zpátky, uplyne 40–100 ms. Kdyby klient čekal,
ovládání by bylo gumové. Řeší se to třemi kusy:

1. **Predikce** – klient si stisk zpracuje sám, hned, funkcí `applyInput()`
   ze `shared/games/arena/sim.js`. Tu samou pak spustí server.
2. **Rekonciliace** – když dorazí snapshot, klient si sedne na pozici serveru
   a přehraje vstupy, které server ještě nestihl potvrdit (`ack`). Zbylý rozdíl
   nedožene skokem, ale nechá ho odtéct během pár snímků, aby postava necukala.
3. **Interpolace** – ostatní hráči se kreslí ~110 ms v minulosti, mezi dvěma
   snapshoty. Proto stačí posílat 15 snapshotů za sekundu (`snapEvery: 2`)
   při simulaci na 30 Hz.

Naměřeno lokálně: **průměrná korekce 1,16 px, maximum 8,7 px** — predikce
klienta se serverem prakticky sedí.

> Sdílená simulace nesmí obsahovat nic nedeterministického – žádné
> `Math.random()`, `Date.now()` ani proměnlivý `dt`. Server i klient musí
> ze stejného vstupu dojít ke stejné pozici, jinak se predikce rozejde.

### Zbraně a power-upy

Na devíti podstavcích se střídavě objevují lékárny, zbraně a power-upy
(vážený los, respawn 11 s). Všechno drží server – kadenci, munici i délku
efektů. Klient posílá jen „chci střílet" a „chci přebít".

| Zbraň | Kadence | Zásobník | Zvláštnost |
|---|---|---|---|
| 🔫 Blaster | 330 ms | 5, přebíjí 1,4 s | 13 poškození, střela 1700 px/s, dostřel 1360 px |
| 🚀 Raketomet | 950 ms | 4 rány | **vybuchne na kurzoru**, přímá rána 58, výbuch 13–38 v okruhu 155 px |
| ⚡ Raygun | 620 ms | 6 ran | okamžitý zásah, prochází skrz hráče |

**Zaměřená raketa.** Raketomet nečeká na náraz – odpálí se tam, kam ukazuje
kurzor. Klient posílá vzdálenost k zaměřovači (`aimD`), server ji ořízne
do mezí zbraně (90–1300 px, zkráceno podle patra) a odečte délku hlavně,
takže výbuch sedne přesně na značku. Ověřeno na 150/400/800/1200 px
s odchylkou 0 px; `aimD` mimo meze se ořízne, takže se tím nedá dostřelit
dál ani si odpálit raketu v ruce.

Ve hře je vidět kruh dopadu i s dosahem výbuchu – červený, když je kurzor
za dostřelem.

> Zaměřená detonace má háček: raketa vybuchne tam, kam se kliklo, takže
> pohyblivý cíl mezitím uteče. Při původních 560 px/s ujel cíl na 400 px
> za dobu letu celých 236 px – tedy daleko mimo výbuch, a raketomet
> vypadal, že vůbec nefunguje. Rychlost je proto 1000 px/s.

Poškození výbuchu podle vzdálenosti od středu (naměřeno):

| Vzdálenost cíle | 200 px | 400 px | 600 px |
|---|---|---|---|
| Cíl stojí | 58 | 58 | 58 |
| Poloviční rychlost | 33 | 28 | 22 |
| Plná rychlost | 28 | 17 | mimo |

Na 600 px v plné rychlosti se tedy musí předsadit – jinde raketa dosáhne.

### Proč je střela tak rychlá

Původních 950 px/s dělalo z trefování hádanku: hráč se pohybuje 330 px/s,
takže na 400 px se muselo předsazovat o **čtyři šířky hráče** a přímé
míření stačilo jen do 66 px. Boti to zvládali (předsazují dokonale),
člověk ne.

| | 950 px/s | 1700 px/s |
|---|---|---|
| Trefíš přímým mířením do | 66 px | **134 px** |
| Předsazení na 200 px | 1,9 šířky hráče | **1,1** |
| Předsazení na 400 px | 3,9 | **2,2** |
| Doba letu na 400 px | 421 ms | **235 ms** |

Úspěšnost botů tím stoupla ze 48 % na 74 %, a protože se `life` zkrátila
na 0,8 s, dostřel zůstal 1360 px – tedy dál, než kam vidíš (950 px).

Naměřeno na 8 botech (hard) přes tři šestiminutové zápasy:

| Zbraň | Výstřelů | Úspěšnost | Poškození na **zásah** | Poškození na **výstřel** |
|---|---|---|---|---|
| Blaster | 1836 | 74 % | 12,6 | 9,3 |
| Raketomet (přímo) | 74 | 20 % | 32,2 | 6,5 |
| Raketomet (výbuch) | – | – | 23,9 | 12,6 |
| Raygun | 81 | 86 % | 23,9 | 20,7 |

Speciálky se pořád vyplatí: raketomet dá 1,16 zabití na jedno sebrání,
raygun 1,40 – a raygun zůstává nejúčinnější na ránu.

> Pozor na rozdíl mezi sloupci: **na zásah** odpovídá nastavení zbraně
> (`dmg`), **na výstřel** je průměr přes všechny rány včetně minutých.
> Blaster má `dmg: 13`, trefí zhruba každá druhá rána – proto 6,1.
>
> Hodnoty na zásah jsou o kousek nižší než nastavení, protože rána do
> umírajícího se započítá jen do nuly. Za tři zápasy se takhle „ztratilo"
> 1949 poškození; u raketometu je proto 35,7 místo 58, protože často
> dobíjí už zraněné.

Se zaměřenou detonací se těžiště raketometu přesunulo z přímých zásahů
do výbuchů – je to teď zbraň na *umístění* rány, ne na trefu.

Speciálky jsou výrazně účinnější na ránu, ale mají jen 4–6 ran a po smrti
o ně přijdeš – proto se vyplatí, ale zápas neurčují.

Speciální zbraně se nepřebíjí. Po vystřílení i po smrti se hráč vrací
k blasteru. Přebít předčasně jde klávesou **R**.

Power-upy: 💨 rychlost, 🛡️ nesmrtelnost, 👻 neviditelnost, 🔥 rychlopalba,
♾️ nekonečné náboje. Neviditelný hráč se ostatním **vůbec neposílá** —
v konzoli se tedy nedá zjistit, kde je.

> Násobič rychlosti sedí na hráči jako `p.spd`, ne v parametrech `applyInput()`.
> Klient si ho nastaví ze snapshotu, takže predikce zrychlí přesně jako server.

### Budovy a výškové úrovně

Mapa je 3200×2200 a stojí na ní šest budov: čtyři rohové (úroveň 1) a
centrální věž (ochoz úroveň 1, jádro úroveň 2). Nahoru vede osm ramp —
okraj plošiny je sráz, jinudy se nahoru ani dolů nedostaneš.

Pravidla výšky:

| | Chování |
|---|---|
| Kdo je výš | pro níže postavené je **neviditelný** – server ho vůbec neposílá |
| Kdo je níž | vidět a střílet se na něj dá bez omezení |
| Střelba nahoru | přímá střela ani paprsek výš postaveného **nezasáhnou** |
| Dosah shora | × 0,72 za každou úroveň (2. patro = 52 % doletu) |
| Výbuch rakety | jako **jediný** ignoruje patra |

Ta poslední řádka je záměrná: bez ní by se obsazená věž nedala vyčistit
a kdo si na ni vyleze první, vyhrál by zápas.

Podstavce jsou i na střechách (4 v patře, 1 na vrcholu věže) — výstup se
tak vyplatí. Věc na jiném patře je vidět zašedle, ale sebrat ji nejde.

Boti umí patra taky: navigace v `arena-nav.js` má vlastní vrstvu pro každou
úroveň a mezi vrstvami se přechází jen po rampě. V odsimulovaném zápase
tráví boti 14–27 % času v budovách a chodí i na věž.

### Události (zaškrtávají se před hrou)

Hostitel je zapne v okně před založením místnosti, ostatní je vidí v čekárně
jako odznaky. Hra si volby popisuje sama (`options` v modulu), hub o žádné
konkrétní neví a server přijme jen deklarované klíče.

Každá pohroma přichází **ve vlnách s náhodným začátkem i trváním** – chvíli
řádí, pak poleví. Dřív měly pevné časování a jednou spuštěné běžely do konce
zápasu, takže z nich byla trvalá kulisa místo události.

| Událost | Chování | Vln za zápas | Trvání vlny |
|---|---|---|---|
| 🌊 **Potopa** | Voda stoupne na zem, po 55 % vlny zaplaví i první patro, na konci opadne. Pod hladinou 40 HP/s. Zachrání střecha nad hladinou nebo **vor**. | ~3 | 42–78 s |
| ☄️ **Meteority** | Roj. Zóna se 2,1 s předem označí, pak dopadne. Různě velké kusy, poškození klesá od středu k okraji. Padají po 2–4 každých 1,9 s. | ~5 | 32–62 s |
| ⛈️ **Bouře** | Blesk se zaměří na nekrytého hráče a udeří s 1,1 s zpožděním za 60 HP. **Krytí = zeď do 95 px** nebo vor. Udeří každých 1,4 s. | ~5 | 30–58 s |
| 🧟 **Zombie apokalypsa** | Nemrtví se valí od okrajů mapy po nejbližším hráči. 45 HP, 15 poškození každých 0,65 s, **lezou i po rampách** – věž tě nezachrání. Nejvýš 30 naráz. | ~3 | 40–75 s |

Zombíci jsou pomalejší než hráč (175 vs 330 px/s), takže se jim dá utéct –
ale nikdy se neunaví a hromadí se. Jeden ubírá 23 HP/s, když ho pustíš
k tělu. Zabít je můžeš čímkoliv; **výbuch rakety trhá celou hordu naráz**,
takže je proti nim zdaleka nejúčinnější.

Mezi sebou se navzájem odtlačují. Bez toho procházeli jeden druhým, slezli
se do chuchvalce a v úzké rampě se zablokovali – 68 % všech zaseknutí bylo
právě tam. Rampy jsou proto široké 150–160 px (projdou čtyři až pět vedle
sebe) a nemrtvý, který se za půl sekundy nikam nedostane, chvíli jde bokem.

| | Před | Po |
|---|---|---|
| Sekund bez postupu | 301 | 100 |
| Z toho na rampách | 204 (68 %) | 23 (23 %) |
| Překrývající se dvojice | 8,6 % | 0,7 % |

### Meteority mají velikost a jádro

Jako u skutečného dopadu: kráter zabíjí, tlaková vlna už jen popálí.
Do 32 % poloměru plná rána, dál klesá až na 22 % na okraji.

| Podíl poloměru | malý (r 150) | střední (r 250) | velký (r 390) |
|---|---|---|---|
| 0–32 % (jádro) | 130 ☠ | 190 ☠ | 270 ☠ |
| 50 % | 103 ☠ | 151 ☠ | 214 ☠ |
| 70 % | 73 | 107 ☠ | 152 ☠ |
| 100 % (okraj) | 29 | 42 | 59 |

☠ = zabije hráče s plným životem. Z malého meteoritu se dá utéct už od
70 % poloměru, z velkého až od 85 % – velikost tedy opravdu rozhoduje.
Losují se v poměru 5 : 3 : 2.

**Každá katastrofa se předem ohlásí.** Nad hrou naskočí pulzující pruh
a okraje obrazovky se zbarví podle druhu pohromy. Ve chvíli, kdy pohroma
opravdu začne, přijde ještě otřes obrazovky a hláška.

> Hlášení schválně **nemá odpočet** a žije mimo `#hud`. Ten se totiž při
> každém snapshotu přestavuje přes `innerHTML`, takže element vznikal
> patnáctkrát za sekundu znovu a CSS animace se pokaždé restartovala –
> pruh viditelně cukal. Teď se DOM dotkneme jen při změně druhu pohromy.

Ohlašuje se **každá vlna**, ne jen ta první: meteority a bouře 8 s předem,
potopa 9 s. Když se hlášení překrývají, ukáže se to naléhavější. Konec vlny
oznámí zelená hláška („Voda opadá", „Roj přešel"), takže je poznat i klid.

Katastrofy jsou schválně **tvrdé**: se zapnutými eventy stoupne úmrtnost
z 9,4 na 24,6 za minutu. Skóre přesto zůstává čitelné (vůdce 8–10 proti
12 bez eventů), protože smrt živlem nebere bod. Limit zásahů se proto
při zapnutých eventech snižuje z `hráčů × 1,5` na `× 1,2`, aby zápas
pořád došel do konce.

Když běží víc událostí naráz, ubere se jim tempo (×1,25).
Bez toho se ze zápasu stalo přežívání – v testu se všemi třemi měli boti
0–3 zásahy a 7–17 smrtí, a blesky trefovaly 47,5 %, protože na malém voru
není kam uhnout.

> Střechy nemají zdi, takže **za bouřky se výhoda výšky obrací proti tobě**.
> Meteorit navíc zasáhne i věž. Obojí je záměrné – jinak by obsazená věž
> byla nedobytná.

Boti události umí: před vodou utíkají na střechu nebo vor (ne na rampu –
na ní si drží původní úroveň a utopili by se na místě) a z označených zón
uhýbají. Respawn se během potopy přesune na suchá místa, jinak hráč obživl
pod vodou a hned se utopil znovu.

### Kdo vystřelí, ten se prozradí

Výška kryje, ale jen dokud mlčíš. Po výstřelu je hráč **1,1 s vidět
i zdola** a dá se v té chvíli normálně trefit. Bez toho byla obsazená věž
nedobytná – v měření tam za čtyři zápasy nepadla jediná smrt.

Raketa navíc bouchne i o výš postaveného (přímá rána tam nedoletí, ale
tlaková vlna ano), takže raketomet je skutečný protilék na kempaře.

Po vyladění dávají všechna patra srovnatelný výdělek:

| Patro | Podíl času | Zabití/min | Smrtí tam |
|---|---|---|---|
| 0 | 82,7 % | 1,7 | 206 |
| 1 | 14,9 % | 1,6 | 13 |
| 2 | 2,4 % | 1,6 | 1 |

### Limit zásahů roste s obsazeností

`fragLimit = max(8, hráčů × 1,5)`. Pevných 20 bylo na zvětšené mapě
nedosažitelných – po šesti minutách měl vůdce 14 (8 hráčů) až 6 (4 hráči),
takže zápas vždy skončil jen na čas. S koeficientem 1,5 dojde vůdce
osmičlenného zápasu na 12 zásahů právě k šesté minutě.

> Koeficient je navázaný na tempo hry. Když se sáhne na poškození zbraní,
> je potřeba ho přeměřit – při zkušebním zeslabení blasteru na 10 spadl
> počet smrtí z 8,3 na 7,1 za minutu a zápasy přestaly na limit docházet.

Smrt živlem (utopení, meteorit, blesk) se počítá jako smrt, ale **bod
nebere** – bod se strhává jen za vlastní raketu pod nohy. Dokud to
trestalo i živly, končily zápasy s eventy skóre 3 místo 12.

### Co v aréně nejde ošidit

Ověřeno útokem z konzole proti běžícímu zápasu:

| Pokus | Výsledek |
|---|---|
| Vektor pohybu délky 50 místo 1 (speedhack) | 155 px/s, limit je 330 – server vektor normalizuje |
| 90 příkazů „střílej" za 1,6 s | 9 ran = 5,7/s, limit serveru 6,1/s |
| Přepsání vlastní pozice na 100,100 | server vrátil 834,1136 |
| Čtení pozic všech hráčů | ze 4 hráčů poslal server jen 1 – zbytek byl za `VIEW_R` |

## Závody

Top-down okruh na 3 kola. Stejný netcode jako aréna: klient poslá jen
`gas` / `steer` / `drift`, vlastní auto si predikuje toutéž funkcí
(`applyInput` ze `shared/games/racing/sim.js`), kterou o chvíli později
spustí server. Naměřeno v prohlížeči: **rozdíl predikce od serveru 0 px**.

Trať je jen **středová čára + poloviční šířka**. Všechno ostatní se z ní
odvodí – kresba, „jsem na asfaltu", kontrolní body i stopa pro boty.
Změna okruhu je proto přepsání pole `LINE`, nic víc.

### Stavěná trať (jako Make Way)

Výchozí režim: hraje se na **5 kol** a každé kolo má dvě fáze.

1. **Stavba** – všichni najednou, **žádné pořadí: kdo položí první, položí první**.
   Každý má box pěti dílů (rovinka, zatáčka, mírná, vlásenka) a k tomu svoje
   turbo, kaluž nebo olej. Kolo skončí, jakmile položí všichni, nejdél po 22 s.
2. **Závod** – jede se celá postavená trať od startu do cíle. Body podle
   pořadí (10/6/3/1) plus bod za dojetí. Vyhrává celkový součet.

> **Proč ne po řadě:** střídaní mělo tichou vadu – ruka se rozdala na začátku
> kola pro tehdejší volný konec, ale než přišel poslední hráč na řadu, konec byl
> už jinde a **všechny jeho díly byly zašedivělé** – neměl co položit. Teď se
> legalita počítá živě v každém snapshotu, takže se nabídka pod rukama sama
> přebarvuje podle toho, co zrovna kdo postavil. Položených dílů za hru:
> **16,3 z 20 → 20 z 20**.

Klíčové je, že **trať byla už předtím jen středová čára**. Stačilo ji změnit
z konstanty na stav a všechno ostatní – kresba, povrch, kontrolní body, rošt,
cílová čára i stopa botů – funguje dál bez úprav. Pevný okruh zůstává jako
volba před hrou.

Díl je popsán v lokálních souřadnicích (začíná v (0,0) směrem +x, končí jinde
a jinak natočený) a skládá se jako autodráha, takže **nesjízdná trať nevznikne**.
Server navíc odmítne díl, který by vedl ven ze světa, křížil už postavenou trať
nebo se k ní přimáčkl blíž než 1,5 šířky.

### Co ukázalo měření stavby

`tools/test-stavba.mjs` odehraje celé hry mezi boty. Každá z těchto chyb
vypadala jako „boti neumí jízdu", a žádná to nebyla:

| Chyba | Jak se projevila |
|---|---|
| Auta ve 2. a 3. řadě roštu stojí 185 a 280 px za prvním kontrolním bodem, jeho dosah je 150 | **nikdy ho nesebrala** a celý závod projela bez postupu – do cíle dojela pokaždé jen první dvě (6/12) |
| Svět 3500×2300 | trať vyjela ven už po čtvrtém dílu a dál se nedalo stavět (3,3 dílu za 20 tahů) |
| Náhodná ruka dílů | většinou samá nemožnost → stavební tah propadl. Teď se dobírá přednostně z toho, co sedí |
| Bot stavěl náhodně | zazdil se po 13 dílech. S pohledem o tah dopředu (kolik možností zůstane) postaí 17 z 20 |
| Předstih botů v ÚSECÍCH | stavěná trať má úseky 170 px, klasika přes 300 – bot se díval o polovinu blíž. Teď v pixelech a v zatáčce se zkracuje |

Po opravách: **12/12 aut v cíli, 0 % času mimo asfalt**, 17 položených dílů,
trať kolem 53 úseků a `hard` vyhrává 3 ze 3 her.

> Ta první chyba stojí za povšimnutí: **24,5 % času „mimo asfalt" nebyla
> chyba řízení** – byla to dvě auta, která doživotně kroužila po trati bez
> možnosti dojet. Po opravě spadlo na nulu.

### Proč to cukalo

**Odpočet blikal.** HUD se přestavoval přes `innerHTML` 15× za sekundu a
pokaždé tím restartoval CSS animaci – **stejná past jako u hlášení katastrof
v aréně**. HUD se teď staví jednou a mění se jen texty; tabulka pořadí až
při změně pořadí. Místo čísla je **semafor** žijící mimo `#hud`:
●○○ → ●●○ → ●●● → zelená. Naměřeno: **0 restartů animace**.

**Jízda vypadala jako teleport.** Predikce se hledá 30× za sekundu, ale obraz
běží na 60–144 fps. Když se kreslí přímo, auto většinu snímků **stí a pak
skočí o 29 px** (880 px/s ÷ 30). Změřeno v `tools/test-plynulost.mjs`:

| Kresleno | Krok mezi snímky | Rozptyl |
|---|---|---|
| přímo predikce, 60 fps | 0,0 – 29,3 px | **2933×** |
| přes filtr, 60 fps | 14,7 – 14,7 px | **1,00×** |
| přes filtr, 144 fps | 6,1 – 6,1 px | **1,00×** |

Řešení má tři části:

1. **Vizuální stav** (`sledujCil` ve sdílené simulaci) dojíždí za predikcí
   filtrem, který běží každý snímek. Je spojitý ze své podstaty, takže
   pohltí i opravu od serveru: skok 300 px se rozloží na 118 px v nejhorším
   snímku místo celku najednou. Zpoždění 22,6 px při plné rychlosti.
2. **Cíl filtru je predikce posunutá o zbytek času** do dalšího kroku podle
   rychlosti. Bez toho se filtr honil za cílem, který sám poskakoval, a
   zbývala v tom vlnka (rozptyl 8,5× místo 1,00×).
3. **Vstupy jedou na akumulátoru podle skutečného času**, ne na
   `setInterval(33 ms)`. Časovač v prohlížeči ujíždí, ale krok se simuloval
   vždy přesně `DT` – klient tak nasimuloval jiný čas než server a ten musel
   pořád dorovnávat dopředu.

Na serveru se k tomu fronta vstupů **dobíhá až dvěma za tick**. Předtím se při
přetečení zahazoval nejstarší vstup – jenže ten si klient už zapředikoval,
takže se pozice trvale rozešly.

Dvě předchozí „opravy" byly slepé uličky a jsou pryč: dokreslování mezi kroky
přes zapamatovaný předchozí stav (po snapshotu zůstal zastaralý, takže se
interpolovalo ze špatného bodu) a dojezd chyby, který se nad 160 px **zahodil**
– tedy tvrdě skočil přesně při nejvyšší rychlosti.

### Zkratka se nevyplácí

Kontrolní body jsou body středové čáry a musí se sebrat **popořadě**.
Ověřeno testem: auto teleportované šestkrát přes cílovou čáru má pořád
**0 kol**. Na trávě navíc platí strop 300 px/s proti 880 px/s na asfaltu,
takže objet zatáčku po louce je pomalejší než ji projet.

### Co ukázalo měření

`tools/test-zavody.mjs` odjede celé závody mezi boty, `tools/test-trat.mjs`
zkouší trať a povrchy cíleně (18 kontrol). Chyby, které by revize kódu
nechytila:

| Chyba | Jak se projevila |
|---|---|
| Znaménko u brzdy | `gas < 0` auto **zrychlovalo** místo brzdění |
| Plyn nerozlišoval boty | zrychlení je vůči odporu tak velké, že terminální rychlost vychází 2090 px/s – všichni bez rozdílu narazili na strop 880 a `easy` jezdil stejně jako `hard` |
| Rozestup na startu | počítal se jako podíl úseku → **19 px mezi řadami** při průměru auta 40 px; kolizní řešič pole na startu rozmetl do trávy |
| Dojezd kolem trati | pod dolní rovinkou zbývalo 168 px – vytěsněné auto rovnou naráželo do zdi světa |

Boti se proto neřídí plynem, ale **cílovou rychlostí do zatáčky** (`tempo`,
`opatrnost`, `minV`). Teprve pak vznikl žebříček:

| Obtížnost | Nejlepší kolo | Mimo asfalt |
|---|---|---|
| easy | 18,2 s | 0 % |
| normal | 13,7 s | 0 % |
| hard | 10,8 s | 0 % |

Ve smíšeném poli vyhrál `hard` **6 z 6** závodů. Uzávěrka po vítězi je 30 s
(původních 12 s nestačilo a třetina pole nedojela).

> **Past v harnessu:** hra měří čas přes `Date.now()`, ale test odjede tisíce
> ticků v jediné milisekundě. Bez virtuálních hodin měla všechna kola čas
> 0,0 s a pořadí v cíli rozhodoval shodný timestamp.

## Dostihy a sázky

Převzato ze staré verze i s texty polí, karet a nájmů — ale logika se
přestěhovala. Ve staré verzi si kostku i celý stav počítal prohlížeč a
výsledek posílal do Firestore; kdo si otevřel konzoli, hodil si šestku
nebo si přidal peníze. Teď klient posílá jen `roll` / `buy` / `build` /
`tradeOffer` a server všechno přepočítá sám.

Ověřeno přímo v prohlížeči: podstrčení `view.canBuild = [id]` v konzoli
tlačítko „Postavit" zobrazí, ale server akci odmítne s **„Musíš vlastnit
celou skupinu."** a peníze ani úroveň se nehnou.

### Dvě věci, které se musely oproti předloze změnit

**Hra nikdy neskončila.** Stavět smí jen majitel celé skupiny, ta se
sejde málokdy, a bez žetonů jsou nájmy nižší než 4000 DK za každé kolo.
Simulace: **0 z 5 zápasů** dohráno ani po 5000 tazích. Přidal jsem strop
`MAX_ROUNDS: 40`; po něm vyhrává nejvyšší čisté jmění (peníze + karty +
žetony). Teď dohraje **20 z 20** zápasů.

**Bank na parkovišti nikdo nevybíral.** Ve staré verzi tam pokuty a
veteriny jen přibývaly. Kdo na PARKOVIŠTĚ stoupne, teď celý bank sebere.

### Co ukázalo měření

`tools/test-dostihy.mjs` odehraje celé partie mezi boty přes stejné funkce,
jaké běží na serveru. Nálezy, které by revize kódu nechytila:

| Chyba | Jak se projevila |
|---|---|
| Bankrot hráče, který byl zrovna na tahu | pořadí se neposunulo, hra visela na mrtvém hráči |
| Bot chtěl kartu, na kterou neměl | server odmítl, `pendingBuy` zůstal → **60 114 pokusů o koupi** v 8 zápasech |
| Časovač tahu | po botově akci se lhůta přepsala na 4 s — i když byl na tahu člověk |

Poslední měření (`node tools/test-dostihy.mjs <hráčů> <zápasů> <obtížnost>`):

| Sestava | Dohráno | Tahů | Staveb | Bankrotů |
|---|---|---|---|---|
| 2 boti (hard) | 6/6 | 61 | 40 | 6 |
| 4 boti (normal) | 8/8 | 144 | 47 | 8 |
| 6 botů (easy) | 6/6 | 240 | 0 | 0 |

Ve třech až čtyřech hráčích to hraje tak, jak má. **V šesti se nikdo
netrefí do celé skupiny**, takže se nestaví vůbec a o vítězi rozhodne
jmění po 40 kolech. Lidi to spraví obchodem na trhu — boti obchodovat
neumí, ti jen kupují a staví.

### Vzhled: herní stůl, ne dashboard

Deska má **vlastní pevnou paletu**, ne barvy motivu hubu — sukno, pergamenová
pole, zlatý rám a serifové písmo (Playfair Display + Cormorant Garamond).
Vypadá stejně v Půlnoci i v Arktidě, protože takhle vypadá skutečná deska;
motiv se drží všude kolem ní (hlavička, hubové modály).

Barevný pruh skupiny míří **vždy do středu desky** — pole si podle svého
čísla samo řekne, na které straně leží (`dh-side-b|l|t|r`), a podle toho se
pruh otočí. Bez toho koukaly pruhy horní řady a bočních sloupců ven a deska
nevypadala jako deska.

### Prodej bance a kolísavý kurz

V předloze prodat neslo vůbec – karty se daly jen kupovat a měnit
s hráči. Přibyl proto výkup:

* Prodávat jde **kdykoliv**, i když je na tahu někdo jiný. Proto se `sell`
  řeší mimo přepínač tahu, hned vedle obchodních akcí.
* **Kurz banky se každé kolo přelosuje** v pásmu 40–80 % ceny. Jedno kolo
  dostaneš za kartu 80 %, druhé jen 40 % – kdo má čas, počká si; kdo
  potřebuje peníze teď, bere, co je.
* Na kartě se žetony se nejdřív rozprodá stavba (`build × kurz`), teprve
  pak karta samotná (`price × kurz`). Prodaná karta propadá bance.
* Karta vystavená na trhu se prodat nedá – jinak by šlo přijmout obchod
  za něco, co už mezitím shrábla banka.

Kurz je vidět na desce („Výkup 46 % ceny“), aby se dal načasovat.

Boti prodávají taky – když klesnou pod 1500 DK, zpeněží nejlevnější
položku, aby při dalším nájmu nezkrachovali. Změřeno A/B na stejných
seedech (12 zápasů, prodej botům zapnutý / vypnutý):

| Hráčů | Prodejů | Bankrotů s prodejem | Bez prodeje |
|---|---|---|---|
| 2 | 17 | **4** | 7 |
| 3 | 20 | 6 | 7 |
| 4 | 7 | 12 | 12 |
| 6 | 8 | 13 | 13 |

Ve dvou hráčích to botům poznatelně prodlužuje život, od čtyř výš už ne –
tam přijde nájem tak velký, že ho jedna prodaná karta nezachrání. Pro
člověka je to jiná věc: ten může prodat předem a počkat si na dobrý kurz.

### Trh

Nabídka je jedna společná a drží celý trh, takže se sama po **90 s**
sundá (`TRADE_MS`). Bez toho by zapomenutá nabídka hráče, který odešel,
zablokovala obchodování napořád — boti ji nepřijmou. Hod kostkou během
otevřeného trhu jde: server ho povoluje, takže ho neblokuje ani klient.

## UNO No Mercy

Podle **oficiálních pravidel**, ne podle předlohy – ta měla několik věcí jinak
nebo vůbec. Tresty se stohují (+2 → +4 → +6 → +10, vždy jen stejné nebo vyšší),
kdo nemá co hrát, líže dokud nevytáhne hratelnou, kdo zapomene říct UNO, dá se
nachytat na +2, a **kdo nasbírá 25 karet, je venku**.

Balíček má 136 karet – 4 barvy × (jedna nula, dvojice 1–9), po dvou od stopky,
obratu, +2, výhozu barvy a stopu všem, plus 20 divokých.

### Čtyři rozdíly proti předloze

Předlohu jsem portoval první a teprve pak dostal oficiální pravidla. Rozešly se
ve čtyřech věcech a rozhodl jsem se pro pravidla:

| | předloha | pravidla |
|---|---|---|
| **Nula** | obyčejné číslo | všichni posílají celou ruku dalšímu v pořadí |
| **Sedmička** | obyčejné číslo | vyměníš si ruku s hráčem, kterého si vybereš |
| **Barevná ruleta** | v balíčku nebyla | další hráč líže, dokud nevytáhne zvolenou barvu, a ztrácí tah |
| **Líznutá hratelná** | smíš ji zahrát, nebo vzdát tah | **musíš** ji zahrát |

A jedna drobnost: u stohování předloha vyžadovala i shodu barvy (modrá +2 se
nesměla přihodit na červenou +2). Oficiální pravidla mluví jen o hodnotě, tak
to barvu neřeší.

Sedmička potřebuje výběr protějšku, takže má – podobně jako sniper v Člověče –
vlastní fázi tahu: dokud si hráč nevybere, nikdo jiný hrát nemůže.

### Stůl, ne pruh nahoře

Hráči sedí kolem stolu: já dole (ruka je v panelu), ostatní po **horním
oblouku**, každý s vějířem rubů natočeným ke středu a jmenovkou s počtem karet
**nad kartami** – pod nimi se pletla do vějíře a u bočních hráčů ho překrývala.
Uprostřed leží balíček, směr hry, aktuální barva a odhoz.

Kolem dokola to schválně není. Obrazovka je široká a ne kulatá, takže dolní
hráči by lezli do vlastní ruky. Vodorovný poloměr je proto menší než svislý,
jinak krajní hráči visí přes okraj a jmenovky se ořízly. Ověřeno pro jednoho
až sedm soupeřů – všichni se vejdou do stolu.

Vějíř se ke stolu naklání jen mírně (35 % úhlu). Při plném natočení by se
zleva i zprava četl svisle a vypadal jako sloupec.

Místa se počítají v pásu **zúženém o půl jmenovky** (`.un-mista{inset:0 104px}`).
Bez toho sedí krajní hráči až u okraje stolu a jmenovka se ořízne – a čím širší
monitor, tím hůř. A protože jména botů už „(bot)“ obsahují, robot navíc se
přidává jen tam, kde postavu převzal bot za nečinného člověka; jinak by jen
zabíral místo. Ověřeno se sedmi soupeři a jmény typu „Ohnivzdorný Bacil (bot)“:
nic oříznutého, nic mimo stůl, a stejně tak na okně širokém 680 px.

### Karty v ruce jsou tajné

Tohle je hlavní důvod, proč hra běží na serveru. V předloze ležely **všechny
ruce v databázi**, takže si kdokoliv mohl v konzoli přečíst karty soupeřů –
u karetní hry je to horší než podvádět s kostkou.

`view()` posílá každému jen jeho vlastní ruku, ostatním jen počty. Naměřeno
v běžící hře: v celé zprávě bylo **8 karet – mých 7 plus vrchní odhozená, ani
jedna navíc**, zatímco soupeři jich drželi 30. Balíček ani odhazovací hromádka
se neposílají vůbec, jen jejich velikost. Celý pohled má 725 znaků.

> Poprvé mi ta kontrola vyšla na 5 karet místo 8 – regulární výraz v testu
> neuměl velké písmeno ve `stopVsem`. Míň karet než čekaných je bezpečný směr,
> ale číslo bylo špatně; po opravě sedí přesně.

Co smí hráč zahrát, taky rozhoduje server (`moznosti`); klient si to nepočítá
sám, aby si nešlo v konzoli povolit cokoliv.

### Tři věci, které měření našlo

**Výhoz barvy karty ničil.** Odložené karty se z ruky jen smazaly a nikam se
nevrátily. Test hlídá, že součet karet ve hře je pořád 136 – bez opravy
neprošel ani jeden zápas z třiceti. Karty teď putují na odhazovací hromádku.

**Vyřazení hráči vysáli balíček.** Jejich ruce zůstávaly mimo hru, takže při
šesti a osmi hráčích drželi vyřazení přes osmdesát karet; balíček i hromádka
se vyprázdnily a všichni už jen donekonečna pasovali. Karty vyřazeného se teď
vracejí do hry – vkládají se **pod** vrchní kartu, ať se nezmění, co je zrovna
ve hře. Předtím se 6 a 8 hráčů nedohrálo nikdy, teď vždycky.

**Stop všem nedělal nic.** V předloze se po něm posouvalo o jednoho hráče, což
je totéž jako obyčejná karta. Karta má přeskočit všechny ostatní, takže hraje
znovu ten samý hráč.

| hráčů | akcí na partii (medián) | vyřazených |
|---|---|---|
| 2 | 53 | 0,1 |
| 4 | 113 | 1,6 |
| 8 | 185 | 4,5 |

(Měřeno až po doplnění oficiálních pravidel; nula a sedmička partie znatelně
promíchávají, takže vyřazení ubylo.)

### Boti

Hodnotí karty podle situace: v souboji o trest přihazují co nejmíň, ať jim
zůstane munice; jinak berou trestací a stopky napřed a divoké si šetří na
konec (ty jsou hratelné vždycky). Barvu volí podle toho, čeho mají v ruce
nejvíc. Slušný bot řekne UNO a chytá cizí zapomenutá, easy na obojí zapomíná.

Hard vyhrává **60,3 %** partií proti easy tam, kde by náhoda dala 50 %.

## Osadníci z Katanu

Deska, pravidla i míchání jsou v `shared/games/katan/` a vyhodnocuje je server.
Klient posílá jen „stavím osadu na vrcholu 17“; kam se smí stavět, mu říká
pohled (`lzeOsada` / `lzeSilnice` / `lzeMesto`), sám si to nepočítá.

### Proč to nemůže běžet v prohlížeči

Předloha měla celý stav ve Firestore, takže **si kdokoliv mohl přečíst, co kdo
drží v ruce**. U zloděje, monopolu nebo obchodu je to celá hra. Tady `view()`
posílá každému jen jeho suroviny a jeho karty – o ostatních jde ven pouhý počet.
Balíček rozvojových karet se neposlílá vůbec, jen kolik v něm zbývá.

Druhá věc je deska. V předloze ji losoval prohlížeč, takže šlo generovat znovu,
dokud u vlastní osady nepadla hezká šestka. Teď ji míchá server ze seedu.

### Kde jsem se od předlohy odchýlil

Čtyři věci předloha řešila jinak, než jak se Katan hraje:

| | předloha | tady |
|---|---|---|
| ruce | veřejné | tajné |
| banka | nekonečná | 19 od každé suroviny |
| nejdelší cesta | lámala se jen vlastní stavbou | láme ji i cizí osada |
| koupená karta | hratelná hned | až příští tah |

Konečná banka má jeden nepříjemný důsledek, který stojí za zmínku: když po
hodu vyjde víc surovin, než kolik jich v bance zbývá, **nedostane je nikdo**
(pokud na ně nemá nárok jediný hráč). To není chyba, tak to Katan má.

### Obchod mezi hráči

Běží vždycky jen jedna nabídka a vidí ji všichni. Kdo ji přijme první, ten
obchoduje – stejně jako u stolu, kde se křičí „berím“. Server před výměnou
znovu ověří, že obě strany na to mají; mezitím totiž mohla přijít sedmička.

Boti nabídku sami nevymyslí, ale umí ji posoudit – berou to, co je posune blíž
k další stavbě, a tvrdý bot nepodrží toho, kdo má osm a víc bodů. Když nabídku
nikdo nechce a není už kdo by ji přijal, sama padne, ať hráč nečumí na něco,
co se nikdy nevyřeší.

### Boti

Rozmístění rozhoduje partii víc než cokoliv později, takže se vrcholy hodnotí
podle teček na žetonech, různosti surovin a přístavu. Rozdíl mezi úrovněmi
není v tom, že by easy hrál náhodně – to je poznát moc – ale **jak přesně si
mezi dobrými místy vybírá**. K tomu tvrdý bot hraje rytíře ještě před hodem
(zloděje z vlastního pole je lepší sundat dřív, než začne výroba), silnici
staví jen když otevře slušné místo, a s bankou mění i ze zásob.

| souboj | výhry | významnost |
|---|---|---|
| hard vs easy | 90,7 % | 14,1 σ |
| normal vs easy | 88,2 % | 13,2 σ |
| hard vs normal | 59,7 % | 3,3 σ |

(300 partijí na souboj, střídá se, kdo začíná.)

### Co hlídá `tools/test-katan.mjs`

55 testů. Kromě pravidel odehraje 25 celých partijí mezi boty a po každém
tahu kontroluje, že **suroviny v rukách plus banka dávají pořád 19 od každé**.
Tahle jedna kontrola chytila víc než všechno ostatní dohromady – karty se
u Katanu ztrácejí na víc místech, než se člověku zdá (zloděj, monopol,
zahazování při sedmičce, obchod).

## Šachy

Pravidla jsou celá na serveru v `shared/games/chess/pravidla.js` — rošáda
včetně zákazu tažení přes napadené pole, brání mimochodem, proměna pěšce,
pat, mat, padesát tahů bez braní, nedostatek materiálu i trojí opakování
pozice. Klient posílá jen „táhnu z e2 na e4“; server si legální tahy
vygeneruje znovu a co mezi nimi není, zahodí.

### Proč perft, a ne pár ručních testů

Šachová pravidla se dají napsat tak, že vypadají správně, a přitom v jedné
pozici z tisíce povolí tah, po kterém zůstane vlastní král v šachu. Ručně
se to nenajde. `tools/test-sachy.mjs` proto spočítá **všechny** průběhy
partie do dané hloubky a porovná je se známými čísly:

| Pozice | Hloubka | Průběhů | Sedí |
|---|---|---|---|
| základní postavení | 4 | 197 281 | ✓ |
| Kiwipete (nabitá rošádami a bráním mimochodem) | 4 | 4 085 603 | ✓ |
| pozice na brání mimochodem | 4 | 43 238 | ✓ |

Kdyby kdekoli přebýval nebo chyběl jediný tah, číslo by se rozešlo o tisíce.
Zbytek testu odehraje školácký mat, pat a krále proti králi — dohromady
18 kontrol, všechny procházejí.

### Bot

Alfa-beta prohledávání s hodnocením materiálu a tabulkami postavení
(`POZICE` v `server/games/chess.js`). Samotný materiál na začátku partie
nic nerozliší — žádný z dvaceti tahů nic nebere, takže mají všechny
stejnou cenu a bot by jen šoupal krajními pěšci. Obtížnosti se liší
hloubkou a tím, jak často sáhne záměrně vedle:

| | hloubka | chyba |
|---|---|---|
| easy | 1 | 35 % |
| normal | 2 | 8 % |
| hard | 3 | 0 % |

### Co soupeř nesmí vědět

`view()` posílá seznam legálních tahů **jen tomu, kdo je na tahu**. Není to
kvůli podvádění — server si každý tah stejně ověří — ale aby si soupeř
nemohl v konzoli přečíst rozbor pozice dřív, než na něj přijde řada.

### Figury a motivy desky

Figury jsou Cburnettova sada (CC BY-SA 3.0, viz
`public/img/chess/LICENCE.md`) uložená **u nás**. Původní verze hry si je
tahala z Wikimedie při každém načtení — když byl jejich server pomalý,
zůstala deska prázdná. Dvanáct souborů má dohromady ~15 kB.

Čtyři vzhledy desky (zelená, dřevo, modrá, noc) mění jen tři CSS proměnné
na `#chDeska` a drží se v `localStorage`. Na server nejdou vůbec: je to věc
hráče, ne partie.

## Člověče, nezlob se

Pravidla jsou převzatá z předlohy doslova: ven jen za šestku na vlastní
startovní pole, do cíle přesným počtem (přešlap neplatí), na vlastní figurku
se nesmí, cizí se vyhodí domů, šestka = házíš znovu, a tři pokusy dostaneš
jen tehdy, když nemáš čím táhnout.

**Kostkou hází server.** V předloze ji losoval prohlížeč přes `Math.random()`
a výsledek zapisoval do databáze — kdo si otevřel konzoli, mohl si hodit
šestku pokaždé. Že je serverová kostka poctivá, ukázalo měření: 16,3 %
šestek ze 42 tisíc hodů proti očekávaným 16,67 %.

### Deska je parametr, ne konstanta

Klasika je kříž 11×11 přesně podle předlohy (40 polí, vstupy na 0/10/20/30).
Velká deska má osm ramen a 80 polí. Kříž se na osm ramen natáhnout nedá, takže
má druhou podobu — kruh. Pravidla o tom **nevědí vůbec nic**: pracují jen
s číslem kroku (`-1` domeček, `0..okruh-1` dráha, dál cíl), souřadnice si
bere až kreslení ze sdílené `geometrie()`. Proto osmičlenná deska není druhá
hra, jen jiná čísla — stejný trik jako trať u závodů.

### Kolik figurek: měřeno, ne odhadnuto

Počet figurek je volba před hrou a je to **jediná věc, která rozhoduje
o délce partie**. Velikost desky je proti tomu skoro jedno:

| | hodů na partii | hráč má na výběr | hody naprázdno |
|---|---|---|---|
| klasika, 4 hráči, 4 figurky | 483 | 35 % | 25 % |
| velká, 8 hráčů, **2 figurky** | 887 | 33 % | 23 % |
| velká, 8 hráčů, 3 figurky | 1 682 | 27 % | 34 % |
| velká, 8 hráčů, 4 figurky | 3 465 | – | – |

Osm hráčů se čtyřmi figurkami je skoro dvě hodiny. Tři figurky jsou horší
ve všem — delší **a** míň rozhodování. Dvě drží poměr rozhodnutí prakticky
stejný jako klasika, proto je velká deska předvyplněná na dvě.

Hostitel si ale počet nastaví sám a u každé možnosti vidí odhad délky.
Odhad není od oka: je to tabulka mediánů ze 40 simulovaných partií na buňku
(`ODHAD` v `shared/games/clovece/const.js`). Test ověřuje, že sedí s realitou —
naposledy slíbeno 440 hodů, naměřeno 455.

### Jediná možnost se zahraje sama

Ve dvou třetinách hodů hráč stejně nemá na výběr (25 % nemá tah vůbec,
41 % má právě jeden). Klikat v takové chvíli na figurku je jen zdržení, takže
se po vteřině zahraje sama. Dělá to **server**, ne klient — kdyby si to
dokresloval každý prohlížeč po svém, stavy by se rozešly.

Když je možností víc, svítí figurky na desce a dole přibude řádek s jejich
čísly, aby se dalo klikat i mimo desku.

### Boti

Heuristika: vyhodit soupeře (tím cennější, čím dál byl), dojít do cíle,
dostat figurku z domečku, jít dopředu. `hard` navíc zkusí tah nanečisto
a spočítá, kolik soupeřů na to pole dosáhne jedním hodem.

| souboj | výhry | významnost |
|---|---|---|
| hard vs easy | 75,0 % | +22,3 σ |
| normal vs easy | 72,0 % | +19,7 σ |
| hard vs normal | 52,6 % | +2,4 σ |

> Napoprvé vycházely všechny obtížnosti na 50 % a vypadalo to na chybu
> v botovi. Chyba byla v měření: `createState` sedadla zamíchá, ale test
> přiřazoval vítěze podle původního pořadí hráčů, takže si výsledky sám
> randomizoval. **Stejná past jako u závodů — než začnu ladit kód, ověřím
> nejdřív harness.**

### Herní módy

Sedm zaškrtávátek, která jdou libovolně kombinovat. Každý mód, který hráči
něco **vnutí nebo vezme, o sobě musí dát vědet** – jinak to vypadá jako chyba
hry („proč nemůžu zahrát tohle?“). Hláška proto vzniká v pravidlech, ne
v prohlíeči, a vidí ji všichni stejně.

| Mód | Co dělá |
|---|---|
| 🐸 **Žába** | Když můžeš přeskočit cizí figurku, musíš. Jako braní v dámě. |
| 🎲 **Double trouble** | Dvě kostky, platí součet (2–12). Na dvou stejných se hází znovu. |
| 🎯 **Sniper** | Kdo vejde do domečku, sundá jednu soupeřovu figurku z dráhy. |
| ⚔️ **Sacrifice** | Místo hodu obětuj dvě svoje figurky z dráhy za jednu soupeřovu. |
| ↩️ **Boomerang** | Za 1 až 3 smíš couvat. Od čtyřky výš se musí dopředu. |
| 🏹 **Lovec odměn** | Za vyhození nasadíš figurku na start; když tam už stojí tvoje, posune se o pole. |
| 😰 **Nervy** | Vyhození se ve 30 % nepovede – figurka zůstane stát a tah propadá. |

Každý mód má vlastní test a jedna kontrola pouští partie **se všemi sedmi
naráz**. Žádná kombinace hru nezasekne:

| | medián hodů na partii |
|---|---|
| bez módů | 434 |
| Sniper | 408 |
| Lovec odměn | 338 |
| Žába | 319 |
| Boomerang | 296 |
| Sacrifice | 289 |
| Nervy | 238 |
| všechny naráz | 233 |

#### Žába a Boomerang: nezávislost je ve spouštěči

Když běží oba, není jasné, jestli se má „muset přeskakovat“ i pozpátku.
Rozhodnutí: **couvnutí žábu nikdy nespustí** (směr dozadu je Boomerangova
věc), ale když už se žába spustí přeskokem dopředu, je to donucení jako
každé jiné – v tom tahu se couvat nesmí. Nezávislost módů je tedy v tom,
CO mód spouští, ne v tom, co po něm zbyde na výběr.

#### Dvě stejné = hází se znovu

Na dvojici se tah nezastavuje – a to i tehdy, když není čím táhnout; pokus se
v tom případě neubere. Šestka jako důvod k dalšímu hodu platí dál, takže
šance na hod navíc je asi 28 %. Partie se tím prodlouží ze 167 na 180 hodů,
což je pořád hluboko pod základní hrou (434).

#### Odhad délky módy nezná

Tabulka je naměřená pro hru **bez módů**. S nimi vychází jinak – Double
trouble ji zkrátí skoro na polovinu. Tabulka pro všech 128 kombinací by byla
nesmysl, takže čekárna místo toho říká, že módy započítané nejsou.

#### Dvě kostky a přesný doskok

Součet má minimum 2, takže **o jedno pole se posunout nedá**. Figurka,
které do volného políčka v cíli chybí právě jedna, už se nehne. Není to
chyba, ale důsledek pravidla o přesném doskoku – a hlídá to test.

#### Kde se losuje

Kostkou hází **výhradně server**. Ale rotace letící kostky, doba letu i místo
dopadu se losují **u klienta** – je to čirá dekorace, do stavu hry nesahá,
a díky tomu dva stejné hody nevypadají stejně. U Double trouble letí kostky
dvě, každá po vlastní dráze a s vlastní rotací.

Hranice je jednoduchá: co rozhoduje o hře, losuje server. Co jen vypadá,
si může každý prohlížeč udělat po svém.

#### Umí to boti?

Ano, ale ne stejně dobře u obou:

| | easy | normal | hard |
|---|---|---|---|
| couvne, když tím někoho vyhodí | 30 % | **96 %** | **95 %** |
| obětuje (z příležitostí) | nikdy | 475 | 802 |

Couvání napřed nefungovalo ani botům, ani lidem: **tah se poznával jen podle
čísla figurky**, takže když měla figurka dopředný i couvací tah, `find` vždycky
vrátila ten dopředný. Couvnout šlo jen tam, kde dopředu nešlo vůbec — což mód
prakticky vyprázdnilo. Bot ho k vyhození využil ve 3 % situací, kdy to šlo.
Teď se tah pozná podle figurky **a směru** a je to 96 %. Hlídá to test.

**Sacrifice bota nezlepší.** Bot, který obětuje při každé příležitosti, prohrává
proti stejně chytrému botovi, co neobětuje — 38,2 % výher, −5,3 σ. Dvě figurky
do domečku jsou drahé, protože zpátky se dostanou jen za šestku. Práh je proto
nastavený na hodnotu, kde je to vyrovnané (rozdíl postupu 8 u hard, 12 u normal):
mód je v botských partiích vidět, ale nepoškozuje je. Easy neobětuje vůbec.

#### Co módy nedělají

Záměrně se neřetězí: Sniperův zásah není „vyhození“ pro Lovce odměn a Nervy
na něj ani na Sacrifice neplatí. Jinak by jedna šestka spustila lavinu,
kterou už nikdo neuhlídá.

### Volby, které se mění až v čekárně

Deska se nedá vybrat při zakládání místnosti: tehdy ještě není známo, kolik
hráčů dorazí. Volby se proto nastavují v čekárně a hra si k nim říká sama —
`normalizeOptions(options, počet)` vrátí opravené hodnoty, zámky a popisky.
Hub o žádné konkrétní volbě neví, jen je vykreslí.

Nad čtyři hráče se klasická deska zamkne a přepne na velkou. Zámek drží
i server: `setOption` zamčenou volbu odmítne, takže ji nejde přepsat z konzole,
a `createState` ji pro jistotu srovná ještě jednou.

## Spuštění

```bash
npm install
npm start
```

Běží na <http://localhost:3000>. `npm run dev` přidá `--watch`.

### Dev režim (testování bez účtů)

```bash
GH_DEV_AUTH=1 npm start
```

Pak v konzoli prohlížeče `ghDev("Tom")` a ve druhém tabu `ghDev("Eva")` —
přihlásí tě bez Firebase účtu a můžeš rovnou hrát proti sobě.

Dev přihlášení funguje **jen z localhostu** a **jen s `GH_DEV_AUTH=1`**.
V produkci tu proměnnou nenastavuj.

## Kdy za tebe začne hrát bot

Dva různé důvody, které se pletí dohromady, ačkoliv nejsou stejné:

| Důvod | Lhůta | Proč právě tak |
|---|---|---|
| **Odpojení** (`BOT_TAKEOVER_MS`) | 3 s | Odpojený hráč nemůže hrát vůbec. Čekat déle by v aréně nechalo stát nehybný terč a v deskovce zaseklo tah. Na návrat je pak 3 minuty. |
| **Nečinnost** (`IDLE_TAKEOVER_MS`) | 2 min | Hráč je připojený, ale nic nedělá. Hra nesmí viset na jednom člověku. |

Jakmile se hráč ozve, bere si postavu zpět – hned, bez čekání.

> **Past:** v realtime hrách teče vstup na server 30× za sekundu i od hráče,
> který nesahá na klávesnici. Kdyby se za aktivitu počítal každý paket,
> nikdo by nečinný nikdy nebyl. Aréna proto implementuje `isActivity()` –
> počítá se pohyb, střelba, přebíjení nebo otočení mířidel. Tahové hry
> hook nemají a každá akce jim platí.

Je to vidět na třech místech: hláška v hubu („Hraje za tebe bot (120 s bez
akce)“), 🤖 u jména v seznamu hráčů a v Dostizích ještě štítek „hraje za
něj bot“. Seznam hráčů dostává hra jako **živý getter** – dokud to byla
kopie z okamžiku připojení, změna se do hry nikdy nedostala.

## Identita hráče

Server potřebuje uid, kterému může věřit — returner systém se řídí právě podle
něj, takže kdyby si ho klient vymýšlel sám, dalo by se ukrást cizí místo
v rozehrané hře. Jsou dvě cesty, obě ověřuje `server/auth.js`:

**Device token (výchozí).** Napíšeš přezdívku a hraješ. Server vydá token
podepsaný HMAC-SHA256 svým klíčem a klient si ho uloží do `localStorage`.
Žádná registrace, žádné heslo, přežije refresh i zavření okna. Podvrhnout
se nedá — ověřeno: token s přepsaným `id` a původním podpisem server odmítl
a vydal místo něj novou náhodnou identitu.

**Firebase login (dobrovolný).** Google nebo e-mail, dá ti trvalý profil
napříč zařízeními. Firebase se v celém hubu nedotkne ničeho jiného —
herní data přes něj neputují. Před nasazením přidej doménu serveru do
Authentication → Settings → Authorized domains (`localhost` tam je defaultně).

### Podpisový klíč

Klíč se při prvním spuštění vygeneruje do `server/.secret` (v `.gitignore`).
Na hostingu bez trvalého disku ho nastav přes `GH_SECRET`, jinak po každém
restartu ztratí všichni hosté identitu.

```bash
GH_SECRET=$(openssl rand -hex 32)
```

## Vzhled a motivy

Šest motivů: **Půlnoc** (výchozí), **Neon**, **Sakura**, **Terminál**,
**Uhlík** a **Arktida** (světlý). Přepínají se v ⚙️ → Vzhled, nebo rovnou
na přihlašovací obrazovce, a pamatují se v `localStorage`.

Palety žijí **jen v CSS** jako proměnné na `[data-theme="…"]`.
`public/js/theme.js` je čte zpátky přes `getComputedStyle` a překlápí do čísel
pro Pixi — díky tomu se motiv propíše i do herní plochy (pozadí plátna, deska,
barvy kamenů), ne jen do menu. Žádná paleta se nikde neduplikuje.

Přidání motivu = jeden blok v `hub.css` a jeden řádek v `THEMES`:

```css
[data-theme="mujmotiv"]{
  --bg:#…; --surface:#…; --acc:#…; --ok:#…; --board:#…; /* … */
}
```

> Motiv se nastavuje ještě v `<head>` malým inline skriptem, ne až modulem.
> Jinak stránka na okamžik problikne výchozí paletou, než doběhne JS.

Hry si barvu berou z proměnných motivu, ne natvrdo — v herním modulu
`this.pal = T.colors()` a překreslení v `T.onThemeChange(...)`.

## Přidání nové hry

Hra = jeden soubor na serveru (pravidla + bot) a jeden na klientu (kreslení).
Žádné vkládání HTML do databáze.

**`server/games/mojehra.js`**

```js
export default {
  id: 'mojehra', title: 'Moje hra', emoji: '🎯',
  minPlayers: 2, maxPlayers: 4,
  realtime: false,          // true → server jede tick smyčku
  tickRate: 20,             // jen pro realtime
  supportsBots: true, botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) { … },      // rng je deterministický, ze serveru
  onAction(state, player, msg, ctx) { … },  // tahovky – tady VALIDUJ
  onInput(state, player, msg, ctx) { … },   // realtime – vstupy hráče
  tick(state, dt, ctx) { … },               // realtime – simulace
  botThink(state, player, ctx) { … },       // vrátí tah/vstup, nebo null
  view(state, uid) { … },                   // co ten hráč SMÍ vidět
  result(state) { … },                      // null | {winners:[uid], reason}
};
```

Zaregistruj ji v `server/games/index.js` a přidej `public/js/games/mojehra.js`
se stejným `id`. Klient si ji načte dynamickým importem sám.

> `view(state, uid)` je zároveň ochrana proti wallhacku: co hráči nepošleš,
> to si v konzoli nepřečte. U real-time her tam patří ořez podle dohledu.

## Nasazení

**Běží to na Oracle Cloud Always Free** (ARM VM, 0 Kč) za Caddy s Let’s
Encrypt certifikátem, doména z DuckDNS. Krok za krokem je to v
`nasazeni/NAVOD.md`; aktualizace je jeden klik na `nasadit.bat`, který nahraje
kopii do `~/gamehub-nove` a teprve pak ji prohodí s běžící — když se přenos
nedokončí, stará verze běží dál.

> `nasadit.bat` ani SSH klíč **nepatří do repozitáře** — tahle složka se celá
> nahrává na server. Podpisový klíč (`GH_SECRET`) žije jen v `/etc/gamehub.env`
> s právy 600.

Server je čistý Node, takže poběží skoro kdekoliv. Kód se mezi variantami nemění.

| Kam | Cena | Poznámka |
|---|---|---|
| **Fly.io** | ~2 $/měs always-on | Plný Node, probuzení z uspání ~1 s. Nejméně starostí. |
| **Oracle Cloud Always Free** | 0 Kč | ARM VM zdarma napořád, ale spravuješ si ji sám. |
| **Koyeb / Railway** | free tier / ~5 $ | Fungují, limity se mění. |
| **Vlastní PC + Cloudflare Tunnel** | 0 Kč | Nulová latence, ale hraje se jen když máš zapnuté PC. |
| ~~Render free~~ | 0 Kč | **Nedoporučuju** — 50 s studený start na hubu je smrt. |

Cloudflare Workers + Durable Objects by architektonicky seděly krásně
(1 místnost = 1 objekt, edge latence), ale free plán má 10 ms CPU na invokaci
a 100 000 requestů/den — 20Hz smyčka ten limit vyčerpá za ~1,5 hodiny.
Na placeném plánu (5 $/měs) by to šlo, ale znamenalo by to přepsat server
do Workers runtime.

Na free tieru, který uspává, se hodí ping na `/health` (vrací i počet
místností a hráčů) třeba přes UptimeRobot.

## Na GitHub

Jedním klikem na `nahrat.bat`. Poprvé se zeptá na adresu repozitáře
(založ **prázdný** na <https://github.com/new> — bez README, bez `.gitignore`,
bez licence, jinak se první nahrání odmítne), pak už si ji pamatuje git sám.

Skript **než cokoliv odešle, ověří, že tajné věci zůstanou doma** a při
nesrovnalosti se zastaví. Ven nejde:

| Co | Proč |
|---|---|
| `server/.secret` | klíč, kterým server podepisuje přihlášení hráčů — kdo ho má, přihlásí se za kohokoliv |
| `nasadit.bat` | je v něm adresa serveru |
| `*.key`, `*.pem` | SSH klíče; kdo je má, je na serveru správcem |
| `node_modules/` | doinstaluje se z `package-lock.json` |

Firebase konfigurace v `public/js/auth.js` tam naopak **patří** — webové klíče
Firebase jsou veřejné z principu, chrání se pravidly na straně Firebase,
ne utajením. Serverí klíče (service account JSON) v projektu nejsou vůbec.

> `Desktop\GameHub-export` **není** zdroj pro GitHub — tu si vyrábí
> `nasadit.bat` jako odkladiště pro `scp`. Na GitHub se posílá přímo tahle
> složka; filtrování obstará `.gitignore`.

`.gitattributes` drží konce řádků na LF i v pracovní kopii. Bez toho by git
na Windows udělal z `nasazeni/gamehub.service` a `Caddyfile` CRLF a systemd
ani Caddy by je na serveru nepřečetly.

## Struktura

```
server/
  index.js        HTTP + WebSocket, routing zpráv, rate limit
  auth.js         ověření Firebase ID tokenu proti Google JWKS
  rooms.js        RoomManager – kódy, matchmaking, úklid
  room.js         Room – tick smyčka, returner systém, převzetí botem
  protocol.js     typy zpráv
  games/          pravidla + boti (běží NA SERVERU)
shared/           konstanty a RNG – importuje server i prohlížeč
tools/            měřicí harnessy – obalují SKUTEČNÉ serverové funkce
                  a odehrají tisíce zápasů mezi boty (bilance, eventy,
                  zombie, trefa, dostihy…). Spouští se `node tools/<soubor>`
public/
  js/net.js       WS klient s auto-reconnectem
  js/hub.js       lepidlo mezi auth, socketem a hrami
  js/pixi.js      jedna Pixi Application na celý hub
  js/games/       renderery (jen kreslí, nic nerozhodují)
```

## Migrace ze starého hubu

Nový hub jede na Firebase projektu **`gamehub-v2`** (jen Auth). Starý hub měl
`gamehub-7fb7c` a hry uložené jako HTML v kolekci `games`.
Nový hub je nečte — hry jsou moduly v kódu. Starý Firestore můžeš nechat být;
přepisuje se jen to, co chceš mít dál.
