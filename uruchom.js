#!/usr/bin/env node
'use strict';
// Uruchamia listę komend w powłoce, którą ma zwykły użytkownik danego systemu, i zapisuje prawdziwe wyjście:
// Windows: Windows PowerShell 5.1 (powershell.exe, domyślny w Windows 11), macOS: zsh, Linux: bash.
// Każda komenda startuje w nowym procesie powłoki, jak w nowo otwartym terminalu (po instalatorze PATH bierzemy z rejestru
// Windows, a na macOS i Linuksie z plików startowych powłoki). Wynik: katalog <wyniki>/<system>/ z plikiem system.json
// (wersje systemu i powłoki, prompt, obraz runnera) i parą NN-<id>.json / NN-<id>.txt na każdą komendę.
// Uwaga: runner GitHub Actions to system serwerowy albo CI (Windows Server, macOS i Ubuntu z obrazu runnera), a nie domowy
// Windows 11 czy zwykły Mac; wyjście komend jest prawdziwe, a wygląd okien bierzemy z innych źródeł.
// Użycie: node uruchom.js <komendy.json> <katalog-wynikow>   (tylko node, bez zależności; Windows, macOS, Linux)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SYSTEMY = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const KATALOGI = new Set(['dom', 'projekt']);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const UWAGA_RUNNERA = 'Runner GitHub Actions: system serwerowy albo CI z obrazu runnera, a nie domowy Windows 11 ani zwykły Mac. '
  + 'Wyjście komend jest prawdziwe; wygląd okien i kolory trzeba brać z innych źródeł.';
// Na Windows nowy terminal czyta PATH z rejestru (maszyna + użytkownik), więc widzi to, co dopisał instalator.
const PATH_Z_REJESTRU = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
  + "[Environment]::GetEnvironmentVariable('Path','User'); ";
// Bez tego Windows PowerShell 5.1 wypisuje do potoku w stronie kodowej OEM i znaki spoza ASCII giną.
const UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
// Kolejność jak w nowym oknie Terminala: /etc/zshrc (tu macOS ustawia prompt „%n@%m %1~ %# ”), potem ~/.zshrc.
const ZSHRC = 'for f in /etc/zshrc "${ZDOTDIR:-$HOME}/.zshrc"; do [ -f "$f" ] && source "$f" >/dev/null 2>&1; done; unset f\n';

/** Sprawdza listę komend; zwraca listę błędów (pusta = poprawna). */
function sprawdzKomendy(dane) {
  const bledy = [];
  const lista = dane && dane.komendy;
  if (!Array.isArray(lista) || !lista.length) return ['brak listy „komendy”'];
  const widziane = new Set();
  lista.forEach((k, i) => {
    const gdzie = `komenda ${i + 1}${k && k.id ? ` (${k.id})` : ''}`;
    if (!k || !ID.test(String(k.id || ''))) bledy.push(`${gdzie}: id z małych liter, cyfr i myślników`);
    else if (widziane.has(k.id)) bledy.push(`${gdzie}: powtórzone id`);
    else widziane.add(k.id);
    if (!k || !k.systemy || typeof k.systemy !== 'object') { bledy.push(`${gdzie}: brak „systemy”`); return; }
    const nazwy = Object.keys(k.systemy);
    if (!nazwy.length) bledy.push(`${gdzie}: pusta lista systemów`);
    for (const s of nazwy) {
      if (!Object.values(SYSTEMY).includes(s)) bledy.push(`${gdzie}: nieznany system „${s}”`);
      if (typeof k.systemy[s] !== 'string' || !k.systemy[s].trim()) bledy.push(`${gdzie}: pusta komenda dla ${s}`);
    }
    if (k.katalog !== undefined && !KATALOGI.has(k.katalog)) bledy.push(`${gdzie}: katalog „${k.katalog}” (dom albo projekt)`);
    if (k.limitS !== undefined && !(Number.isInteger(k.limitS) && k.limitS > 0 && k.limitS <= 900)) bledy.push(`${gdzie}: limitS 1–900`);
  });
  return bledy;
}

/** Program i argumenty, którymi zwykły użytkownik danego systemu uruchomiłby komendę w nowym terminalu. */
function wywolanie(system, komenda) {
  // Windows: komenda idzie w zmiennej środowiskowej i jest parsowana jako osobny skrypt. Wklejona za przygotowaniem
  // (kodowanie, PATH) trafiała do komunikatów błędów: „At line:1 char:189 + ... GetEnvironmentVariable(...); claude”,
  // a w prawdziwym oknie jest „At line:1 char:1 + claude --version”. Wywołanie bloku samo kończy się sukcesem, więc
  // błąd komendy przekazujemy jako kod wyjścia w linii za nią (bez tego każda komenda dawała kod 0).
  if (system === 'windows') {
    const kodWyjscia = 'if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }';
    return {
      program: 'powershell.exe',
      argumenty: ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', `${UTF8}${PATH_Z_REJESTRU}. ([scriptblock]::Create($env:KURS_KOMENDA + "\`n" + '${kodWyjscia}'))`],
      srodowisko: { KURS_KOMENDA: komenda },
    };
  }
  // zsh czyta komendę z wejścia: przy `-c` komunikaty błędów mają numer linii („zsh:1: command not found”), a w oknie
  // Terminala go nie ma („zsh: command not found”). Tryb interaktywny (-i) bez prawdziwego terminala dopisuje do wyjścia
  // prompty i sekwencje tytułu okna, więc zamiast niego czytamy ~/.zshrc tak jak nowe okno Terminala (po ~/.zprofile z -l).
  if (system === 'macos') return { program: '/bin/zsh', argumenty: ['-l', '-s'], wejscie: `${ZSHRC}${komenda}\n` };
  if (system === 'linux') return { program: '/bin/bash', argumenty: ['-l', '-c', komenda] };
  throw new Error(`nieznany system ${system}`);
}

/** Komenda, która wypisuje prompt widoczny w nowym terminalu danego systemu. */
function komendaPromptu(system) {
  if (system === 'windows') return 'prompt';
  if (system === 'macos') return 'print -rP -- "$PROMPT"';
  // Ubuntu ustawia PS1 w ~/.bashrc tylko w powłoce interaktywnej, więc przy `bash -c` jest pusty; bierzemy domyślny
  // prompt z /etc/skel/.bashrc („\u@\h:\w\$ ”), bez kolorów.
  return 'PS1=\'\\u@\\h:\\w\\$ \'; echo "${PS1@P}"';
}

/** Tekst, jaki zobaczyłby człowiek: prompt z komendą, potem wyjście (stdout, a po nim stderr). */
function tekstTerminala({ prompt, komenda, stdout, stderr }) {
  const wyjscie = [stdout, stderr].filter((t) => t && t.length).map((t) => t.replace(/\r\n/g, '\n').replace(/\n$/, '')).join('\n');
  return `${prompt.replace(/\r?\n$/, '')}${komenda}\n${wyjscie}${wyjscie ? '\n' : ''}`;
}

const nazwaPliku = (lp, id) => `${String(lp).padStart(2, '0')}-${id}`;

function uruchom(system, komenda, cwd, limitS, spawn = spawnSync, env = process.env) {
  const { program, argumenty, wejscie = '', srodowisko = {} } = wywolanie(system, komenda);
  const start = Date.now();
  const r = spawn(program, argumenty, { cwd, env: { ...env, ...srodowisko }, encoding: 'utf8', input: wejscie, timeout: limitS * 1000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return {
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    kod: r.status,
    przerwane: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
    blad: r.error && r.error.code !== 'ETIMEDOUT' ? String(r.error.message) : null,
    czasMs: Date.now() - start,
  };
}

/** Wersje systemu i powłoki, zapisywane w każdym wyniku. */
function wersje(system, cwd, spawn = spawnSync) {
  const zapytaj = (k) => uruchom(system, k, cwd, 60, spawn).stdout.trim();
  if (system === 'windows') {
    return {
      powloka: 'Windows PowerShell',
      powlokaWersja: zapytaj('$PSVersionTable.PSVersion.ToString()'),
      systemWersja: zapytaj("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [Environment]::OSVersion.Version.ToString()"),
    };
  }
  if (system === 'macos') {
    return { powloka: 'zsh', powlokaWersja: zapytaj('echo $ZSH_VERSION'), systemWersja: zapytaj('echo "$(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion))"') };
  }
  return { powloka: 'bash', powlokaWersja: zapytaj('echo $BASH_VERSION'), systemWersja: zapytaj('. /etc/os-release && echo "$PRETTY_NAME"') };
}

function main(argv) {
  const [plikKomend, katalogWynikow] = argv;
  if (!plikKomend || !katalogWynikow) { console.error('Użycie: node uruchom.js <komendy.json> <katalog-wynikow>'); return 2; }
  const system = SYSTEMY[process.platform];
  const dane = JSON.parse(fs.readFileSync(plikKomend, 'utf8'));
  const bledy = sprawdzKomendy(dane);
  if (bledy.length) { for (const b of bledy) console.error(`- ${b}`); return 1; }
  const dom = os.homedir();
  const projekt = path.join(dom, 'notatki');
  fs.mkdirSync(projekt, { recursive: true });
  const wyniki = path.join(katalogWynikow, system);
  fs.mkdirSync(wyniki, { recursive: true });
  const prompt = (cwd) => uruchom(system, komendaPromptu(system), cwd, 30).stdout.replace(/\r?\n$/, '');
  const opis = {
    system,
    ...wersje(system, dom),
    obrazRunnera: [process.env.ImageOS, process.env.ImageVersion].filter(Boolean).join(' ') || null,
    uwaga: UWAGA_RUNNERA,
    katalogi: { dom, projekt },
    prompt: { dom: prompt(dom), projekt: prompt(projekt) },
    data: new Date().toISOString(),
    przebieg: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  };
  fs.writeFileSync(path.join(wyniki, 'system.json'), `${JSON.stringify(opis, null, 2)}\n`);
  let lp = 0;
  for (const k of dane.komendy) {
    const komenda = k.systemy[system];
    if (!komenda) continue;
    lp += 1;
    const cwd = k.katalog === 'projekt' ? projekt : dom;
    const p = prompt(cwd);
    const wynik = uruchom(system, komenda, cwd, k.limitS || 120);
    const nazwa = nazwaPliku(lp, k.id);
    fs.writeFileSync(path.join(wyniki, `${nazwa}.json`), `${JSON.stringify({ id: k.id, opis: k.opis || null, system, katalog: cwd, prompt: p, komenda, ...wynik }, null, 2)}\n`);
    fs.writeFileSync(path.join(wyniki, `${nazwa}.txt`), tekstTerminala({ prompt: p, komenda, ...wynik }));
    console.log(`${nazwa}: kod ${wynik.kod}${wynik.przerwane ? ' (przerwane po limicie)' : ''}, ${wynik.czasMs} ms`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { sprawdzKomendy, wywolanie, komendaPromptu, tekstTerminala, nazwaPliku, uruchom, wersje, UWAGA_RUNNERA };
