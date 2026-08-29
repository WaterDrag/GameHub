@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   Game Hub - nahrani na GitHub
echo   ============================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo   CHYBA: tohle neni git slozka.
  echo   Spust v ni jednou:  git init -b main
  goto :konec
)

rem ------------------------------------------------------------------
rem  Pojistka. Tenhle skript je jedno tlacitko, takze si pred kazdym
rem  odeslanim overi, ze klic k podpisu tokenu a adresa serveru
rem  porad NEJDOU ven. Kdyby nekdo sahnul na .gitignore, zastavi se.
rem ------------------------------------------------------------------
echo   [1/5] Kontroluji, ze tajne veci zustanou doma...
if exist "server\.secret" (
  git check-ignore -q "server/.secret"
  if errorlevel 1 (
    echo.
    echo   STOP: server\.secret by slo na GitHub.
    echo   To je klic, kterym server podepisuje prihlaseni hracu.
    echo   Oprav .gitignore a zkus to znovu.
    goto :konec
  )
)
if exist "nasadit.bat" (
  git check-ignore -q "nasadit.bat"
  if errorlevel 1 (
    echo.
    echo   STOP: nasadit.bat by slo na GitHub - je v nem adresa serveru.
    echo   Oprav .gitignore a zkus to znovu.
    goto :konec
  )
)
for /f "delims=" %%f in ('git ls-files --cached --others --exclude-standard') do (
  echo %%f | findstr /I /R "\.key$ \.pem$ \.secret$ id_rsa" >nul && (
    echo.
    echo   STOP: mezi soubory je %%f - to na GitHub nepatri.
    goto :konec
  )
)
echo         v poradku

rem ------------------------------------------------------------------
rem  Kam to posilat. Pta se jen poprve, pak si to pamatuje git sam.
rem ------------------------------------------------------------------
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [2/5] Jeste nevim, kam nahravat.
  echo.
  echo         Zaloz prazdny repozitar na https://github.com/new
  echo         DULEZITE: nezaskrtavej README, .gitignore ani licenci,
  echo         jinak se ti prvni nahrani odmitne.
  echo.
  set /p "URL=        Vloz adresu (napr. https://github.com/jmeno/gamehub.git): "
  if "!URL!"=="" (
    echo   Nic jsi nevlozil, koncim.
    goto :konec
  )
  git remote add origin "!URL!"
  if errorlevel 1 goto :chyba
) else (
  for /f "delims=" %%r in ('git remote get-url origin') do echo   [2/5] Cil: %%r
)

rem ------------------------------------------------------------------
echo   [3/5] Ukladam zmeny...
git add -A
if errorlevel 1 goto :chyba

git diff --cached --quiet
if errorlevel 1 (
  for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "STAMP=%%d"
  git commit -q -m "Aktualizace !STAMP!"
  if errorlevel 1 goto :chyba
  echo         ulozeno
) else (
  echo         zadne zmeny, posilam jen to, co jeste neodeslo
)

rem ------------------------------------------------------------------
echo   [4/5] Nahravam na GitHub...
echo         (poprve otevre prohlizec kvuli prihlaseni)
git push -u origin main
if errorlevel 1 goto :chyba

rem ------------------------------------------------------------------
echo   [5/5] Overuji...
git fetch -q origin
for /f "delims=" %%a in ('git rev-parse HEAD') do set "MISTNI=%%a"
for /f "delims=" %%b in ('git rev-parse origin/main') do set "VZDALENY=%%b"
if not "!MISTNI!"=="!VZDALENY!" (
  echo.
  echo   POZOR: na GitHubu je neco jineho, nez mas tady.
  goto :konec
)

echo.
echo   HOTOVO. Vse je na GitHubu.
for /f "delims=" %%r in ('git remote get-url origin') do echo   %%r
echo.
goto :konec

:chyba
echo.
echo   NEPOVEDLO SE. Chyba je vypsana vys.
echo   Nejcastejsi duvody:
echo     - repozitar na GitHubu neni prazdny (zalozil jsi ho s README)
echo     - spatne heslo / token v prihlasovacim okne
echo     - neni internet
echo.

:konec
pause
endlocal
