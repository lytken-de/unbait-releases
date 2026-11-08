# unbAIt DK – udgivelser

Offentlige udgivelser af Chrome-udvidelsen **unbAIt DK**, der omskriver clickbait-overskrifter på danske nyhedssider med AI. Koden ligger i et privat repo; her ligger kun de færdige udgaver.

- **`latest.json`** – den nyeste version. Udvidelsen læser filen højst én gang i døgnet og viser en besked i indstillingerne, når der er en ny version.
- **`releases/`** – zip-filen for hver version (`unbaitdk-v1.XX-chrome.zip`).

## Opdatering
1. Hent zip-filen for den nyeste version i `releases/` (linket står også i `latest.json`).
2. Pak den ud over den gamle mappe.
3. Tryk på genindlæs ved unbAIt DK på `chrome://extensions`.

Er udvidelsen indlæst fra en git-mappe, opdateres den i stedet med `git pull` i mappen og genindlæs.
