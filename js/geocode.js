/**
 * Lähitaksi hinta-arvio: osoitehaku (OpenStreetMap).
 *
 * Kokeilee palveluja järjestyksessä: Photon, sitten Nominatim.
 * Tulokset rajataan Suomeen ja Uudenmaan osoitteet näytetään ensin.
 */
(function (root, factory) {
  root.LahitaksiGeocode = factory(root.LahitaksiConfig);
})(self, function (config) {
  'use strict';

  const { SERVICES, MAP } = config;
  const MAX_RESULTS = 6;

  function inBox(point, box) {
    return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
  }

  /** Suomen ulkopuoliset ja tuplat pois, Uusimaa ensin (muuten palvelun oma järjestys). */
  function rank(results) {
    const seen = new Set();
    return results
      .filter(r => inBox(r.coord, MAP.finlandBox) && !seen.has(r.label) && seen.add(r.label))
      .sort((a, b) => inBox(b.coord, MAP.uusimaaBox) - inBox(a.coord, MAP.uusimaaBox))
      .slice(0, MAX_RESULTS);
  }

  function photonLabel(p) {
    const street = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '';
    const name = p.name && p.name !== street ? p.name : '';
    return [name, street, p.city || p.town || p.village || p.county].filter(Boolean).join(', ');
  }

  function nominatimLabel(x) {
    const a = x.address || {};
    const street = a.road ? a.road + (a.house_number ? ' ' + a.house_number : '') : '';
    const name = x.name && x.name !== a.road ? x.name : '';
    return [name, street, a.city || a.town || a.village || a.municipality].filter(Boolean).join(', ') || x.display_name;
  }

  async function photon(query) {
    const [lat, lon] = MAP.searchBias;
    const url = `${SERVICES.photon}?q=${encodeURIComponent(query)}&limit=15&lat=${lat}&lon=${lon}&bbox=19.0,59.5,31.6,70.1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Photon ' + res.status);
    const json = await res.json();
    return json.features
      .filter(f => f.properties.countrycode === 'FI')
      .map(f => ({ label: photonLabel(f.properties), coord: [f.geometry.coordinates[1], f.geometry.coordinates[0]] }));
  }

  async function nominatim(query) {
    const url = `${SERVICES.nominatim}?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1` +
      '&countrycodes=fi&viewbox=22.8,60.85,26.6,59.75&limit=15&accept-language=fi';
    let json;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Nominatim ' + res.status);
      json = await res.json();
    } catch (e) {
      json = await jsonp(url, 'json_callback'); // jos fetch on estetty
    }
    return json.map(x => ({ label: nominatimLabel(x), coord: [Number(x.lat), Number(x.lon)] }));
  }

  const PROVIDERS = [photon, nominatim];

  /**
   * Hakee osoite-ehdotukset.
   * @param {string} query
   * @returns {Promise<{label:string, coord:number[]}[]>}
   */
  async function search(query) {
    let lastError = null;
    for (const provider of PROVIDERS) {
      try {
        const results = rank(await provider(query));
        if (results.length) return results;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  /** JSONP-pyyntö <script>-tagilla. Toimii myös, jos fetch on estetty. */
  let jsonpId = 0;
  function jsonp(url, callbackParam, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const name = '__lahitaksiJsonp' + (++jsonpId);
      const script = document.createElement('script');
      const cleanup = () => { delete window[name]; script.remove(); clearTimeout(timer); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('palvelu ei vastaa')); }, timeoutMs);
      window[name] = data => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('palvelu ei vastaa')); };
      script.src = `${url}&${callbackParam}=${name}`;
      document.head.appendChild(script);
    });
  }

  return { search, jsonp };
});
