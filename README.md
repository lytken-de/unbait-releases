# unbAIt DK

Chrome-udvidelsen **unbAIt DK** omskriver clickbait-overskrifter på danske nyhedssider til neutrale, informative overskrifter med AI.

Dette repo indeholder den nyeste færdige udgave af udvidelsen (filerne i roden), `latest.json` med versionsnummeret og zip-filen med samme version i `releases/`. Ældre versioner ligger ikke her.

## Installation og opdatering med git
1. Hent repoet:
   ```bash
   git clone https://github.com/lytken-de/unbait-releases.git unbait
   ```
2. Gå til `chrome://extensions`, slå **Udviklertilstand** til, vælg **Indlæs upakket**, og vælg mappen `unbait`.
3. Opdatering: kør `git pull` i mappen, og tryk på genindlæs ved unbAIt DK på `chrome://extensions`.

Udvidelsen viser selv en besked i indstillingerne, når der er en ny version.

**ChromeOS:** git kræver Linux-miljøet (Terminal → penguin). Læg mappen under **My files** og del den med Linux (højreklik → Del med Linux), og hent repoet ind i den, fx `git clone https://github.com/lytken-de/unbait-releases.git /mnt/chromeos/MyFiles/unbait`. Indlæst fra »Linux files« virker udvidelsen ikke efter en genstart, før Linux er startet.

## Installation og opdatering med zip
1. Hent zip-filen i `releases/` (linket står også i `latest.json`).
2. Pak den ud i en mappe, og indlæs mappen med **Indlæs upakket** på `chrome://extensions`.
3. Opdatering: pak den nye zip-fil ud over den gamle mappe, og tryk på genindlæs.

Indlæses udvidelsen fra en ny mappe, starter den med tomme indstillinger. Brug **Sikkerhedskopi** i indstillingerne til at flytte dem.

## Licens
Se `LICENSE.txt` (unbAIt DK-licensen).
