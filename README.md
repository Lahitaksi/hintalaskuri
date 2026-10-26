# Lähitaksi hinta-arvio

Verkkosivulle upotettava laskuri, joka näyttää taksimatkan hinta-arvion kartalla. Käyttäjä valitsee lähtö- ja kohdeosoitteen (ja halutessaan välietappeja), ja laskuri näyttää reitin, matkan pituuden, keston sekä hinnan 1–4 ja 5–8 hengelle.

Hinnoittelu vastaa vanhan HERE-pohjaisen laskurin logiikkaa. Kartta, osoitehaku ja reititys käyttävät OpenStreetMap-dataa, joten API-avaimia ei tarvita.

## Ominaisuudet

- Osoitehaku Suomesta, Uudenmaan osoitteet ensin
- Välietapit (enintään 4)
- Reitti kartalla, matkan pituus ja kesto
- Hinnoittelualue päätellään lähtöpaikasta: Uusimaa, Rovaniemi, Kittilä, Helsinki-Vantaa, satamat
- Kiinteät hinnat Helsinki-Vantaa ↔ keskusta
- Lisäpalvelut: ennakkotilaus, Business Class, lastenistuin, pakettikuljetus
- Toimii myös puhelimella

## Käyttöönotto

Projekti on pelkkää HTML:ää, CSS:ää ja JavaScriptiä. Build-vaihetta ei ole.

```bash
git clone <repo-url>
cd lahitaksi-hinta-arvio
npm start          # paikallinen palvelin osoitteeseen http://localhost:8080
```

Tuotantoon riittää kopioida kansion sisältö mille tahansa web-palvelimelle.

> **Huom:** Avaa sivu palvelimen kautta, älä tuplaklikkaamalla tiedostoa. OpenStreetMap estää suoraan koneelta (`file://`) avatut sivut. Siinä tapauksessa laskuri käyttää varakarttaa, mutta haku voi silti olla estetty.

## Rakenne

```
index.html            Sivun rakenne
css/style.css         Ulkoasu
js/config.js          Hinnasto, alueet ja palveluiden osoitteet
js/pricing.js         Hinnoittelu ja alueen tunnistus (ei riippuvuuksia, testattavissa)
js/geocode.js         Osoitehaku (Photon, varalla Nominatim)
js/routing.js         Reititys (Valhalla ja OSRM, nopein reitti valitaan)
js/app.js             Käyttöliittymä ja kartta
tests/                Hinnoittelun testit
```

## Hintojen päivittäminen

Kaikki hinnat ovat tiedostossa [`js/config.js`](js/config.js) kohdassa `TARIFFS`. Esimerkiksi Uudenmaan päiväkilometrihinta:

```js
uusimaa: {
  perKm: {
    small: { day: 1.10, night: 1.15 },  // 1-4 hlö
    large: { day: 1.75, night: 1.75 }   // 5-8 hlö
  },
  ...
}
```

Muutoksen jälkeen aja testit ja päivitä odotetut arvot tiedostossa `tests/pricing.test.js`:

```bash
npm test
```

## Hinnan laskenta

Kaava on sama kuin vanhassa laskurissa:

1. **Pohjahinta** = aloitusmaksu + minuutit × minuuttihinta.
   Minuutteina käytetään pienempää kahdesta: reittipalvelun antama aika tai arvio `km / (40 + min(km / 1,6, 40)) × 60 + 5`.
2. **Hinta** = pohjahinta + km × kilometrihinta + lisät (ennakkotilaus, lastenistuin, Business Class).
3. Aluekohtaiset säännöt:
   - Rovaniemi: 5–8 hlö +4,20 €
   - Uusimaa ja satamat: 5–8 hlö päivällä +3,70 €, minimihinta 11,50 €, Business Classin minimi 55 € / 65 €
   - Satamat (Länsiterminaali T2, Katajanokka): satamalisä 3,60 €
   - Helsinki-Vantaa → keskusta: kiinteä 40,90 € / 65,00 €
   - Keskusta → Helsinki-Vantaa: kiinteä 50,00 € / 65,00 €
   - Kittilän lentoasema: +4 €
   - Pakettikuljetus: hinta muunnetaan 14 %:n alvista 25,5 %:n alviin

Aluekoodit (0–8) ovat samat kuin vanhassa laskurissa, jotta tuloksia on helppo verrata.

## Ulkoiset palvelut

| Käyttö | Palvelu | Huomio |
|---|---|---|
| Kartta | OpenStreetMap | [Käyttöehdot](https://operations.osmfoundation.org/policies/tiles/) |
| Osoitehaku | Photon, Nominatim | [Nominatimin käyttöehdot](https://operations.osmfoundation.org/policies/nominatim/) |
| Reititys | Valhalla (FOSSGIS), OSRM | Ilmaisia demopalvelimia |
| Kirjasto | Leaflet 1.9.4 | cdnjs |

Ilmaiset palvelut sopivat kohtuulliseen käyttöön. Jos laskurin käyttö kasvaa suureksi, kannattaa harkita omaa Valhalla/Nominatim-palvelinta tai maksullista karttapalvelua. Palveluiden osoitteet vaihdetaan kohdassa `SERVICES` tiedostossa `js/config.js`.

## Tunnetut rajoitukset

- Reitti tulee OpenStreetMap-datasta, joten matka voi poiketa hieman Googlen tai HEREn reitistä.
- Pyhäpäiviä ei tunnisteta automaattisesti. Ajankohdan oletus on arkisin 06–18 päivä, muuten ilta.
- Hinta-arvio ei ole sitova. Lopullinen hinta riippuu ajetusta reitistä ja liikenteestä.
