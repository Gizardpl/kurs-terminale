# kurs-terminale

Prawdziwe wyjście terminali na Windows, macOS i (opcjonalnie) Linuksie, zebrane na standardowych runnerach GitHub Actions.
Lista komend jest wejściem. Każda komenda startuje w nowym procesie powłoki, której używa zwykły użytkownik:
- Windows: Windows PowerShell 5.1 (`powershell.exe`, domyślny w Windows 11; `pwsh` nie jest używany),
- macOS: zsh,
- Linux: bash.

**Ważne:** runner to system serwerowy albo CI z obrazu GitHub (Windows Server, macOS i Ubuntu runnera), a nie domowy
Windows 11 ani zwykły Mac. Wyjście komend jest prawdziwe. Wyglądu okien i kolorów stąd nie bierzemy. Git i Node.js są na
runnerach już zainstalowane. Komendy, które wymagają logowania albo wpisania czegoś z klawiatury, kończą się limitem czasu
albo błędem (wejście jest puste).

## Wynik

Artefakt `wyniki-<system>` zawiera:
- `system.json`: wersję systemu i powłoki, obraz runnera, prompt w katalogu domowym i w projekcie, adres przebiegu;
- `NN-<id>.txt`: to, co widać w terminalu (prompt z komendą, potem wyjście);
- `NN-<id>.json`: osobno stdout i stderr, kod wyjścia, czas, informację, czy komendę przerwał limit czasu.

## Uruchomienie (hurtowe, potem wyłączenie)

Workflow jest domyślnie wyłączony i włączamy go tylko na jeden hurtowy przebieg:

```
gh workflow enable terminale.yml -R Gizardpl/kurs-terminale
gh workflow run terminale.yml -R Gizardpl/kurs-terminale -f systemy=windows,macos
gh run watch -R Gizardpl/kurs-terminale --exit-status
gh run download <numer-przebiegu> -R Gizardpl/kurs-terminale
gh workflow disable terminale.yml -R Gizardpl/kurs-terminale
```

- `systemy`: `windows,macos` (domyślnie) albo `windows,macos,linux`.
- `komendy`: opcjonalnie lista w JSON (`{"komendy":[...]}`); bez niej workflow bierze `komendy.json` z repo.

Format jednej komendy: `{ "id": "git-wersja", "opis": "…", "katalog": "dom" | "projekt", "limitS": 120,
"systemy": { "windows": "git --version", "macos": "git --version", "linux": "git --version" } }`. Katalog `projekt` to pusty
folder `notatki` w katalogu domowym.

## Koszt

Repo jest publiczne i używa wyłącznie standardowych runnerów (`windows-latest`, `macos-latest`, `ubuntu-latest`), za które
publiczne repozytoria nie płacą. Runnerów „larger” nie używamy.
