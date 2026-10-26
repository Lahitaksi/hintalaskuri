/**
 * Lähitaksi hinta-arvio: käyttöliittymä.
 *
 * Kytkee yhteen kartan (Leaflet), osoitehaun, reitityksen ja hinnoittelun.
 */
(function (config, pricing, geocode, routing) {
  'use strict';

  const { MAP, SERVICES, LOCATION_NAMES } = config;
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- tila

  const state = {
    time: defaultTime(),
    preorder: false,
    business: false,
    childSeat: false,
    package: false,
    route: null
  };

  /** Arkisin 06-18 = päivä, muuten ilta. Pyhäpäiviä ei tunnisteta automaattisesti. */
  function defaultTime() {
    const now = new Date();
    const hour = now.getHours(), weekday = now.getDay();
    return weekday >= 1 && weekday <= 5 && hour >= 6 && hour < 18 ? 'day' : 'night';
  }

  // ---------------------------------------------------------------- kartta

  const map = L.map('map', { zoomControl: false }).setView(MAP.center, MAP.zoom);
  L.control.zoom({ position: 'topleft' }).addTo(map);

  // OSM estää suoraan koneelta avatut sivut, joten paikallisessa testissä käytetään varapohjaa
  if (location.protocol === 'file:') {
    L.tileLayer(SERVICES.tilesLocal, { maxZoom: 19, attribution: '© Esri, OpenStreetMap' }).addTo(map);
  } else {
    L.tileLayer(SERVICES.tiles, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  }

  let routeLayer = null;

  function markerIcon(label, background, color) {
    return L.divIcon({
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html: `<div class="mk" style="background:${background};color:${color}">${label}</div>`
    });
  }

  function iconFor(stop) {
    if (stop.type === 'start') return markerIcon('A', '#FFD200', '#111');
    if (stop.type === 'end') return markerIcon('B', '#111214', '#FFD200');
    return markerIcon(stop.label, '#fff', '#3a3d42');
  }

  /** Panelin alle jäävä alue huomioidaan, kun reitti sovitetaan näkyviin. */
  function fitPadding() {
    return window.innerWidth > 760
      ? { paddingTopLeft: [60, 60], paddingBottomRight: [440, 80] }
      : { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40] };
  }

  // ---------------------------------------------------------------- pysähdykset

  const stops = [];
  const stopsEl = $('stops');

  function addStop(type, placeholder) {
    const el = document.createElement('div');
    el.className = 'field';
    const dotClass = { start: 'a', end: 'b', via: 'v' }[type];
    el.innerHTML =
      `<span class="dot ${dotClass}"><b></b></span>` +
      `<input placeholder="${placeholder}" autocomplete="off" aria-label="${placeholder}">` +
      (type === 'via' ? '<button type="button" class="rm" title="Poista välietappi">×</button>' : '') +
      '<div class="sugg" role="listbox"></div>';

    const stop = { type, el, input: el.querySelector('input'), coord: null, marker: null, label: '' };

    if (type === 'via') {
      const end = stops.find(s => s.type === 'end');
      stopsEl.insertBefore(el, end.el);
      stops.splice(stops.length - 1, 0, stop);
      el.querySelector('.rm').addEventListener('click', () => removeStop(stop));
    } else {
      stopsEl.appendChild(el);
      stops.push(stop);
    }

    setupAutocomplete(stop);
    relabel();
    return stop;
  }

  function removeStop(stop) {
    if (stop.marker) map.removeLayer(stop.marker);
    stop.el.remove();
    stops.splice(stops.indexOf(stop), 1);
    relabel();
    if (allStopsSet()) calculate();
  }

  function relabel() {
    let n = 1;
    stops.forEach(stop => {
      stop.label = stop.type === 'via' ? String(n++) : stop.type;
      if (stop.type === 'via') stop.el.querySelector('.dot b').textContent = stop.label;
      if (stop.marker) stop.marker.setIcon(iconFor(stop));
    });
  }

  const allStopsSet = () => stops.every(s => s.coord);

  addStop('start', 'Mistä lähdetään?');
  addStop('end', 'Minne mennään?');

  $('add-via').addEventListener('click', () => {
    if (stops.length < MAP.maxVias + 2) addStop('via', 'Välietappi').input.focus();
  });

  // ---------------------------------------------------------------- osoitehaku

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function setupAutocomplete(stop) {
    const list = stop.el.querySelector('.sugg');
    let timer = null, items = [], active = -1;

    const hide = () => { list.style.display = 'none'; };

    stop.input.addEventListener('input', () => {
      stop.coord = null;
      clearTimeout(timer);
      const query = stop.input.value.trim();
      if (query.length < 3) return hide();

      timer = setTimeout(async () => {
        try {
          items = await geocode.search(query);
          showError('');
          list.innerHTML = items.map((it, i) => `<div role="option" data-i="${i}">${escapeHtml(it.label)}</div>`).join('');
          active = -1;
          list.style.display = items.length ? 'block' : 'none';
          list.querySelectorAll('div').forEach(row => {
            row.addEventListener('mousedown', e => { e.preventDefault(); select(items[Number(row.dataset.i)]); });
          });
        } catch (e) {
          showError(`Osoitehaku ei vastaa (${e.message}).`);
        }
      }, 300);
    });

    stop.input.addEventListener('keydown', e => {
      const rows = list.querySelectorAll('div');
      if (!rows.length || list.style.display === 'none') return;
      if (e.key === 'ArrowDown') active = Math.min(active + 1, rows.length - 1);
      else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
      else if (e.key === 'Enter') { e.preventDefault(); select(items[Math.max(active, 0)]); return; }
      else if (e.key === 'Escape') return hide();
      else return;
      e.preventDefault();
      rows.forEach((row, i) => row.classList.toggle('on', i === active));
    });

    stop.input.addEventListener('blur', () => setTimeout(hide, 150));

    function select(item) {
      stop.input.value = item.label;
      stop.coord = item.coord;
      hide();
      if (stop.marker) stop.marker.setLatLng(item.coord);
      else stop.marker = L.marker(item.coord, { icon: iconFor(stop) }).addTo(map);
      if (allStopsSet()) calculate();
      else map.setView(item.coord, 14);
    }
  }

  // ---------------------------------------------------------------- valinnat

  const timeButtons = $('time-select').querySelectorAll('button');
  timeButtons.forEach(button => {
    button.classList.toggle('on', button.dataset.value === state.time);
    button.addEventListener('click', () => {
      state.time = button.dataset.value;
      timeButtons.forEach(b => b.classList.toggle('on', b === button));
      render();
    });
  });

  const switches = {};
  document.querySelectorAll('.sw[data-option]').forEach(input => {
    const option = input.dataset.option;
    switches[option] = input;
    input.addEventListener('change', () => {
      state[option] = input.checked;
      // Business Class ja pakettikuljetus eivät ole voimassa yhtä aikaa
      if (option === 'business' && input.checked) setOption('package', false);
      if (option === 'package' && input.checked) setOption('business', false);
      render();
    });
  });

  function setOption(option, value) {
    state[option] = value;
    switches[option].checked = value;
  }

  // ---------------------------------------------------------------- laskenta

  const calcButton = $('calculate');
  calcButton.addEventListener('click', () => {
    if (!allStopsSet()) return showError('Valitse osoitteet ehdotuslistasta.');
    calculate();
  });

  function showError(message) {
    $('error').textContent = message;
  }

  async function calculate() {
    showError('');
    calcButton.disabled = true;
    calcButton.textContent = 'Lasketaan…';
    try {
      const route = await routing.getRoute(stops.map(s => s.coord));
      state.route = route;
      drawRoute(route);
      if (route.approximate) showError('Reittipalvelu ei vastannut, matka arvioitu linnuntiestä.');
      render();
    } catch (e) {
      showError('Reitin haku epäonnistui. Yritä uudelleen.');
    }
    calcButton.disabled = false;
    calcButton.textContent = 'Laske hinta-arvio';
  }

  function drawRoute(route) {
    if (routeLayer) map.removeLayer(routeLayer);
    const dash = route.approximate ? '1 12' : null;
    routeLayer = L.layerGroup([
      L.polyline(route.line, { color: '#111214', weight: 9, opacity: 0.9, dashArray: dash }),
      L.polyline(route.line, { color: '#FFD200', weight: 5, opacity: 1, dashArray: dash })
    ]).addTo(map);
    map.fitBounds(L.latLngBounds(route.line), fitPadding());
  }

  // ---------------------------------------------------------------- näkymä

  function formatDuration(min) {
    return min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  }

  function render() {
    $('label-small').textContent = state.package ? 'Pieni paketti' : '1–4 hlö';
    $('label-large').textContent = state.package ? 'Iso paketti' : '5–8 hlö';

    if (!state.route) {
      $('price-small').textContent = '–';
      $('price-large').textContent = '–';
      $('notes').textContent = '';
      return;
    }

    const start = stops[0].coord;
    const end = stops[stops.length - 1].coord;
    const location = pricing.getLocation(start, end, stops.length > 2);

    // Business Class vain Uudenmaan taksalla
    const businessOk = pricing.businessAvailable(location);
    switches.business.disabled = !businessOk;
    switches.business.closest('.opt').style.opacity = businessOk ? 1 : 0.4;
    if (!businessOk && state.business) setOption('business', false);

    const fares = pricing.calculateFares({
      distanceKm: state.route.distanceKm,
      durationMin: state.route.durationMin,
      location,
      time: state.time,
      preorder: state.preorder,
      childSeat: state.childSeat,
      business: state.business,
      package: state.package
    });

    $('trip-distance').textContent = state.route.distanceKm.toFixed(2).replace('.', ',') + ' km';
    $('trip-duration').textContent = formatDuration(fares.durationMin);
    $('trip-area').textContent = LOCATION_NAMES[location];
    $('price-small').textContent = pricing.formatEuro(fares.small);
    $('price-large').textContent = pricing.formatEuro(fares.large);
    $('notes').textContent = fares.notes.join(' ');
    $('card-small').classList.add('on');
  }

  render();
})(window.LahitaksiConfig, window.LahitaksiPricing, window.LahitaksiGeocode, window.LahitaksiRouting);
