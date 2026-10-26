/**
 * Lähitaksi hinta-arvio: hinnasto ja alueet.
 *
 * Kaikki hinnat ovat euroja. "day" = arkisin 06-18, "night" = 18-06 sekä pyhät.
 * "small" = 1-4 henkilöä, "large" = 5-8 henkilöä.
 *
 * Hinnoittelun kaava on tiedostossa js/pricing.js. Hintojen muuttamiseen
 * riittää yleensä tämän tiedoston muokkaaminen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LahitaksiConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Aluekoodit. Samat numerot kuin vanhassa laskurissa (getPriceFare),
   * jotta vertailu on helppoa.
   */
  const LOCATION = {
    ROVANIEMI: 0,
    KITTILA: 1,
    HEL_AIRPORT: 3,          // lähtö Helsinki-Vantaalta, muu kohde
    HEL_AIRPORT_TO_CENTRE: 4, // kiinteä hinta
    CENTRE_TO_HEL_AIRPORT: 5, // kiinteä hinta
    DEFAULT: 6,              // Uusimaa ym.
    KITTILA_AIRPORT: 7,
    HARBOUR: 8               // lähtö Länsiterminaali T2 tai Katajanokka
  };

  const LOCATION_NAMES = {
    0: 'Rovaniemi',
    1: 'Kittilä',
    3: 'Helsinki-Vantaa',
    4: 'Kenttä → keskusta',
    5: 'Keskusta → kenttä',
    6: 'Uusimaa',
    7: 'Kittilän lentoasema',
    8: 'Satama'
  };

  const TARIFFS = {
    rovaniemi: {
      startFee: { day: 8.20, night: 8.20 },
      perMinute: { day: 0.85, night: 0.85 },
      perKm: {
        small: { day: 1.45, night: 1.45 },
        large: { day: 2.05, night: 2.05 }
      },
      preorder: { small: 0, large: 0 },
      childSeat: 10.50,
      largeExtra: 4.20 // 5-8 hlö aloitusmaksun ero
    },

    kittila: {
      startFee: { day: 9.50, night: 12.50 },
      perMinute: { day: 1.10, night: 1.10 },
      perKm: {
        small: { day: 1.60, night: 1.60 },
        large: { day: 2.10, night: 2.10 }
      },
      preorder: { small: 8.50, large: 8.50 },
      childSeat: 10.50,
      airportExtra: 4.00 // lähtö tai kohde Kittilän lentoasemalla
    },

    uusimaa: {
      startFee: { day: 4.50, night: 8.20 },
      perMinute: { day: 0.98, night: 1.08 },
      perKm: {
        small: { day: 1.10, night: 1.15 },
        large: { day: 1.75, night: 1.75 }
      },
      preorder: { small: 5.50, large: 10.50 },
      childSeat: 5.50,
      largeDayExtra: 3.70,  // 5-8 hlö aloitusmaksun ero päivällä
      minimumFare: 11.50,
      harbourFee: 3.60,
      business: {
        extra: { small: 20.00, large: 25.00 },
        minimum: { small: 55.00, large: 65.00 }
      },
      fixed: {
        airportToCentre: { small: 40.90, large: 65.00 },
        centreToAirport: { small: 50.00, large: 65.00 }
      }
    },

    // Pakettikuljetus: hinta muutetaan 14 %:n alvista 25,5 %:n alviin
    package: {
      vatFrom: 1.14,
      vatTo: 1.255,
      vatLabel: '25,5 %'
    },

    // Arvioitu ajoaika (sama kaava kuin vanhassa laskurissa).
    // Aikahinta lasketaan pienemmästä: reittipalvelun aika tai tämä arvio.
    timeEstimate: {
      baseSpeed: 40,
      extraSpeedDivisor: 1.6,
      maxExtraSpeed: 40,
      extraMinutes: 5
    }
  };

  /**
   * Alueiden rajat [minLat, minLng, maxLat, maxLng].
   * Laskettu vanhan laskurin polygoneista. Vanha laskuri tarkisti alueet
   * rajaavalla suorakulmiolla, joten tämä toimii täsmälleen samoin.
   */
  const ZONES = {
    rovaniemi:   [66.155399, 24.736799, 67.177119, 27.32665],
    kittila:     [67.151289, 24.09343, 68.395289, 26.00784],
    centre:      [60.142516, 24.895725, 60.177741, 24.983051], // postinumerot 00100-00180, 00220
    helAirport:  [60.31654, 24.96334, 60.3190489, 24.9701804],
    kttAirport:  [67.6846729, 24.8335271, 67.7159672, 24.8649932],
    westHarbour: [60.14734931, 24.90968836, 60.15253987, 24.91968764], // Länsiterminaali T2
    katajanokka: [60.1630204, 24.9599255, 60.1662867, 24.9762043]
  };

  /** Ulkoiset palvelut (kaikki OpenStreetMap-dataa). */
  const SERVICES = {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    // OSM estää suoraan koneelta (file://) avatut sivut, joten paikallisessa testissä käytetään tätä
    tilesLocal: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    photon: 'https://photon.komoot.io/api/',
    nominatim: 'https://nominatim.openstreetmap.org/search',
    valhalla: 'https://valhalla1.openstreetmap.de/route',
    osrm: 'https://router.project-osrm.org/route/v1/driving/'
  };

  /** Kartan ja haun asetukset. */
  const MAP = {
    center: [60.22, 24.85],
    zoom: 11,
    searchBias: [60.17, 24.94],
    finlandBox: [59.5, 19.0, 70.1, 31.6],
    uusimaaBox: [59.75, 22.8, 60.85, 26.6],
    maxVias: 4
  };

  return { LOCATION, LOCATION_NAMES, TARIFFS, ZONES, SERVICES, MAP };
});
