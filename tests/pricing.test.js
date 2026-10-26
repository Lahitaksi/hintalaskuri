/**
 * Hinnoittelun testit. Aja: npm test (tai node --test tests/)
 *
 * Odotetut arvot on laskettu vanhan laskurin kaavalla, jotta uusi laskuri
 * antaa samat hinnat samalla matkalla ja ajalla.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCATION } = require('../js/config.js');
const { getLocation, calculateFares, businessAvailable } = require('../js/pricing.js');

const fares = (overrides) => calculateFares({
  distanceKm: 10,
  durationMin: 15,
  location: LOCATION.DEFAULT,
  time: 'day',
  ...overrides
});

test('aluekoodit', () => {
  const helsinki = [60.20, 24.95];
  assert.equal(getLocation(helsinki, [65.01, 25.47], false), LOCATION.DEFAULT);
  assert.equal(getLocation([66.50, 25.73], helsinki, false), LOCATION.ROVANIEMI);
  assert.equal(getLocation([67.80, 24.80], helsinki, false), LOCATION.KITTILA);
  assert.equal(getLocation([67.80, 24.80], [67.70, 24.85], false), LOCATION.KITTILA_AIRPORT);
  assert.equal(getLocation([60.3175, 24.968], [65.0, 25.5], false), LOCATION.HEL_AIRPORT);
  assert.equal(getLocation([60.3175, 24.968], [60.168, 24.94], false), LOCATION.HEL_AIRPORT_TO_CENTRE);
  assert.equal(getLocation([60.3175, 24.968], [60.168, 24.94], true), LOCATION.HEL_AIRPORT, 'välietappi poistaa kiinteän hinnan');
  assert.equal(getLocation([60.168, 24.94], [60.3175, 24.968], false), LOCATION.CENTRE_TO_HEL_AIRPORT);
  assert.equal(getLocation([60.150, 24.915], helsinki, false), LOCATION.HARBOUR);
});

test('Helsinki-Oulu päivällä vastaa vanhaa laskuria', () => {
  const r = fares({ distanceKm: 605.86, durationMin: 413.35 });
  assert.equal(r.small, 1076.03);
  assert.equal(r.large, 1473.54);
});

test('Uusimaa päivä: 10 km, 15 min', () => {
  // 4,50 + 15 * 0,98 + 10 * 1,10 = 30,20; 5-8 hlö: 4,50 + 14,70 + 17,50 + 3,70 = 40,40
  const r = fares({});
  assert.equal(r.small, 30.20);
  assert.equal(r.large, 40.40);
});

test('Uusimaa ilta: 10 km, 15 min', () => {
  const r = fares({ time: 'night' });
  assert.equal(r.small, 35.90);
  assert.equal(r.large, 41.90);
});

test('aikahinta lasketaan pienemmästä ajasta', () => {
  // 10 km arvioitu aika = 10 / (40 + 6,25) * 60 + 5 = 17,97 min, joten 60 min ei nosta hintaa
  const slow = fares({ durationMin: 60 });
  const estimate = fares({ durationMin: 17.97 });
  assert.equal(slow.small, estimate.small);
});

test('minimihinta 11,50 €', () => {
  const r = fares({ distanceKm: 1, durationMin: 2 });
  assert.equal(r.small, 11.50);
});

test('lisät: ennakkotilaus ja lastenistuin', () => {
  const r = fares({ preorder: true, childSeat: true });
  assert.equal(r.small, 41.20);  // 30,20 + 5,50 + 5,50
  assert.equal(r.large, 56.40);  // 40,40 + 10,50 + 5,50
});

test('Business Class: lisä ja minimi', () => {
  const r = fares({ business: true });
  assert.equal(r.small, 55.00);  // 30,20 + 20 = 50,20 < 55
  assert.equal(r.large, 65.40);  // 40,40 + 25 = 65,40
  assert.equal(businessAvailable(LOCATION.ROVANIEMI), false);
  assert.equal(businessAvailable(LOCATION.DEFAULT), true);
});

test('satamalisä 3,60 €', () => {
  const r = fares({ location: LOCATION.HARBOUR });
  assert.equal(r.small, 33.80);
  assert.equal(r.large, 44.00);
  assert.ok(r.notes.some(n => n.includes('satamalisä')));
});

test('kiinteät kenttähinnat', () => {
  const toCentre = fares({ location: LOCATION.HEL_AIRPORT_TO_CENTRE, distanceKm: 20, durationMin: 25 });
  assert.equal(toCentre.small, 40.90);
  assert.equal(toCentre.large, 65.00);

  const toAirport = fares({ location: LOCATION.CENTRE_TO_HEL_AIRPORT, distanceKm: 20, durationMin: 25, preorder: true });
  assert.equal(toAirport.small, 55.50);
  assert.equal(toAirport.large, 75.50);
});

test('Rovaniemi: 5-8 hlö +4,20 €, lastenistuin 10,50 €', () => {
  // 8,20 + 15 * 0,85 + 10 * 1,45 + 10,50 = 45,95
  const r = fares({ location: LOCATION.ROVANIEMI, childSeat: true });
  assert.equal(r.small, 45.95);
  assert.equal(r.large, 56.15);  // 8,20 + 12,75 + 20,50 + 10,50 + 4,20
});

test('Kittilän lentoasema +4 €', () => {
  const kittila = fares({ location: LOCATION.KITTILA });
  const airport = fares({ location: LOCATION.KITTILA_AIRPORT });
  assert.equal(airport.small, Math.round((kittila.small + 4) * 100) / 100);
});

test('pakettikuljetus muuntaa alvin', () => {
  const r = fares({ package: true });
  assert.equal(r.small, Math.round(30.20 / 1.14 * 1.255 * 100) / 100);
});
