/**
 * Lähitaksi hinta-arvio: hinnoittelu.
 *
 * Laskenta vastaa vanhan laskurin funktioita getPriceFare, calcPrice ja calcFloor.
 * Laskujärjestys on tärkeä: lisät, alv-muunnos, minimit ja kiinteät hinnat
 * tehdään samassa järjestyksessä kuin vanhassa laskurissa.
 *
 * Moduuli ei koske DOMiin, joten sitä voi testata Nodella (ks. tests/).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.LahitaksiPricing = factory(root.LahitaksiConfig);
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const { LOCATION, TARIFFS, ZONES } = config;

  /** Onko piste [lat, lng] alueen rajaavan suorakulmion sisällä. */
  function inZone(point, zone) {
    const [minLat, minLng, maxLat, maxLng] = ZONES[zone];
    return point[0] >= minLat && point[0] <= maxLat && point[1] >= minLng && point[1] <= maxLng;
  }

  /**
   * Päättelee hinnoittelualueen lähtö- ja kohdepisteestä.
   * @param {number[]} start [lat, lng]
   * @param {number[]} end [lat, lng]
   * @param {boolean} hasVia onko reitillä välietappeja (kiinteät hinnat eivät silloin päde)
   * @returns {number} aluekoodi, ks. config.LOCATION
   */
  function getLocation(start, end, hasVia) {
    let location = LOCATION.DEFAULT;

    if (inZone(start, 'rovaniemi')) location = LOCATION.ROVANIEMI;

    if (inZone(start, 'kittila')) {
      location = LOCATION.KITTILA;
      if (inZone(start, 'kttAirport') || inZone(end, 'kttAirport')) location = LOCATION.KITTILA_AIRPORT;
    }

    if (inZone(start, 'helAirport')) {
      location = LOCATION.HEL_AIRPORT;
      if (inZone(end, 'centre') && !hasVia) location = LOCATION.HEL_AIRPORT_TO_CENTRE;
    }

    if (inZone(start, 'centre') && inZone(end, 'helAirport') && !hasVia) {
      location = LOCATION.CENTRE_TO_HEL_AIRPORT;
    }

    if (inZone(start, 'westHarbour') || inZone(start, 'katajanokka')) location = LOCATION.HARBOUR;

    return location;
  }

  /** Kaikki muut paitsi Rovaniemi ja Kittilä käyttävät Uudenmaan taksaa. */
  function tariffFor(location) {
    if (location === LOCATION.ROVANIEMI) return TARIFFS.rovaniemi;
    if (location === LOCATION.KITTILA || location === LOCATION.KITTILA_AIRPORT) return TARIFFS.kittila;
    return TARIFFS.uusimaa;
  }

  /** Onko Business Class käytettävissä alueella. */
  function businessAvailable(location) {
    return Boolean(tariffFor(location).business);
  }

  /** Arvioitu ajoaika minuutteina matkan pituuden perusteella. */
  function estimatedMinutes(distanceKm) {
    const t = TARIFFS.timeEstimate;
    const extraSpeed = Math.min(distanceKm / t.extraSpeedDivisor, t.maxExtraSpeed);
    return distanceKm / (t.baseSpeed + extraSpeed) * 60 + t.extraMinutes;
  }

  /**
   * Laskee hinta-arvion.
   * @param {object} p
   * @param {number} p.distanceKm reitin pituus
   * @param {number} p.durationMin reitin kesto reittipalvelun mukaan
   * @param {number} p.location aluekoodi (getLocation)
   * @param {'day'|'night'} p.time
   * @param {boolean} [p.preorder]
   * @param {boolean} [p.childSeat]
   * @param {boolean} [p.business]
   * @param {boolean} [p.package]
   * @returns {{small:number, large:number, durationMin:number, notes:string[]}}
   */
  function calculateFares(p) {
    const loc = p.location;
    const tariff = tariffFor(loc);
    const period = p.time === 'night' ? 'night' : 'day';
    const isUusimaa = tariff === TARIFFS.uusimaa;
    const usesUusimaaMinimums = loc === LOCATION.DEFAULT || loc === LOCATION.HARBOUR;
    const business = Boolean(p.business && tariff.business);
    const notes = [];

    const preorder = p.preorder ? tariff.preorder : { small: 0, large: 0 };
    const childSeat = p.childSeat ? tariff.childSeat : 0;
    const businessExtra = business ? tariff.business.extra : { small: 0, large: 0 };

    // Aikahinta: pienempi reittipalvelun ajasta ja arvioidusta ajasta
    const estimate = estimatedMinutes(p.distanceKm);
    const minutes = Math.min(p.durationMin, estimate);
    const base = tariff.startFee[period] + minutes * tariff.perMinute[period];

    let small = base + preorder.small + childSeat + businessExtra.small + p.distanceKm * tariff.perKm.small[period];
    let large = base + preorder.large + childSeat + businessExtra.large + p.distanceKm * tariff.perKm.large[period];

    if (loc === LOCATION.ROVANIEMI) large += tariff.largeExtra;

    if (p.package) {
      const v = TARIFFS.package;
      small = small / v.vatFrom * v.vatTo;
      large = large / v.vatFrom * v.vatTo;
      notes.push(`Paketit sis. alv ${v.vatLabel}. Iso paketti tarkoittaa tilataksia.`);
    }

    if (loc === LOCATION.HARBOUR) {
      small += tariff.harbourFee;
      large += tariff.harbourFee;
      notes.push(`Hintaan sisältyy satamalisä ${formatEuro(tariff.harbourFee)}.`);
    }

    if (usesUusimaaMinimums && period === 'day') large += tariff.largeDayExtra;

    if (usesUusimaaMinimums && small < tariff.minimumFare) {
      small = tariff.minimumFare;
      if (large < tariff.minimumFare) large = tariff.minimumFare;
    }

    if (usesUusimaaMinimums && business) {
      small = Math.max(small, tariff.business.minimum.small);
      large = Math.max(large, tariff.business.minimum.large);
    }

    if (isUusimaa && loc === LOCATION.HEL_AIRPORT_TO_CENTRE) {
      small = tariff.fixed.airportToCentre.small + businessExtra.small + preorder.small;
      large = tariff.fixed.airportToCentre.large + businessExtra.large + preorder.large;
      notes.push('Kiinteä hinta Helsinki-Vantaalta keskustaan.');
    }

    if (isUusimaa && loc === LOCATION.CENTRE_TO_HEL_AIRPORT) {
      small = tariff.fixed.centreToAirport.small + businessExtra.small + preorder.small;
      large = tariff.fixed.centreToAirport.large + businessExtra.large + preorder.large;
      notes.push('Kiinteä hinta keskustasta Helsinki-Vantaalle.');
    }

    if (loc === LOCATION.KITTILA_AIRPORT) {
      small += tariff.airportExtra;
      large += tariff.airportExtra;
    }

    return {
      small: round2(small),
      large: round2(large),
      durationMin: Math.min(Math.ceil(p.durationMin), Math.ceil(estimate)),
      notes
    };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function formatEuro(n) {
    return n.toFixed(2).replace('.', ',') + ' €';
  }

  return { getLocation, calculateFares, businessAvailable, estimatedMinutes, formatEuro };
});
