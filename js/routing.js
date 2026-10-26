/**
 * Lähitaksi hinta-arvio: reititys (OpenStreetMap).
 *
 * Hakee reittivaihtoehdot rinnakkain Valhallasta ja OSRM:stä ja valitsee
 * nopeimman, kuten Google ja vanha laskuri. Jos kumpikaan ei vastaa,
 * matka arvioidaan linnuntiestä.
 */
(function (root, factory) {
  root.LahitaksiRouting = factory(root.LahitaksiConfig, root.LahitaksiGeocode);
})(self, function (config, geocode) {
  'use strict';

  const { SERVICES } = config;
  const SERVICE_TIMEOUT_MS = 5000;

  /** Hylkää lupauksen, jos palvelu ei vastaa ajoissa. Näin yksi hidas palvelu ei jumita laskentaa. */
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('aikakatkaisu')), ms))
    ]);
  }

  /** Valhallan polyline (tarkkuus 6 desimaalia) -> [[lat, lng], ...] */
  function decodePolyline6(str) {
    let index = 0, lat = 0, lng = 0;
    const out = [];
    while (index < str.length) {
      for (const isLng of [false, true]) {
        let byte, shift = 0, result = 0;
        do {
          byte = str.charCodeAt(index++) - 63;
          result |= (byte & 31) << shift;
          shift += 5;
        } while (byte >= 32);
        const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (isLng) lng += delta; else lat += delta;
      }
      out.push([lat / 1e6, lng / 1e6]);
    }
    return out;
  }

  async function valhalla(points) {
    const body = {
      locations: points.map(([lat, lon]) => ({ lat, lon, type: 'break' })),
      costing: 'auto',
      units: 'kilometers',
      alternates: points.length === 2 ? 2 : 0,
      costing_options: { auto: { use_ferry: 0 } }
    };
    const url = `${SERVICES.valhalla}?json=${encodeURIComponent(JSON.stringify(body))}`;
    let json;
    try {
      const res = await fetch(url);
      json = await res.json();
    } catch (e) {
      json = await geocode.jsonp(url, 'callback'); // jos fetch on estetty
    }
    if (!json.trip) return [];
    const trips = [json.trip, ...(json.alternates || []).map(a => a.trip)];
    return trips.map(trip => ({
      distanceKm: trip.summary.length,
      durationMin: trip.summary.time / 60,
      line: trip.legs.flatMap(leg => decodePolyline6(leg.shape))
    }));
  }

  async function osrm(points) {
    const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const url = `${SERVICES.osrm}${coords}?overview=full&geometries=geojson&alternatives=${points.length === 2}`;
    const res = await fetch(url);
    const json = await res.json();
    return (json.routes || []).map(r => ({
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    }));
  }

  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  /** Karkea arvio, jos reittipalvelut eivät vastaa: linnuntie x 1,35, 40 km/h. */
  function straightLineEstimate(points) {
    let km = 0;
    for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
    km *= 1.35;
    return { distanceKm: km, durationMin: km / 40 * 60, line: points, approximate: true };
  }

  /**
   * Hakee nopeimman reitin pisteiden kautta.
   * @param {number[][]} points [[lat, lng], ...] lähtö, välietapit, kohde
   * @returns {Promise<{distanceKm:number, durationMin:number, line:number[][], approximate?:boolean}>}
   */
  async function getRoute(points) {
    const results = await Promise.allSettled([
      withTimeout(valhalla(points), SERVICE_TIMEOUT_MS),
      withTimeout(osrm(points), SERVICE_TIMEOUT_MS)
    ]);
    const routes = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (!routes.length) return straightLineEstimate(points);
    return routes.sort((a, b) => a.durationMin - b.durationMin)[0];
  }

  return { getRoute };
});
