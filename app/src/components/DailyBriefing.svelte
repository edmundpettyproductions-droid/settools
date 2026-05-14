<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as data from '../lib/data';
  import { smartGeocode, getForecast, wmoLabel, fmtTime12 } from '../lib/weather';
  import { googleMapsUrl, appleMapsUrl, nearestHospitalUrl } from '../lib/url';
  import type { DailyForecast, UHState, PTProject, PTDay, PersonCounts, GeocodeResult } from '../lib/types';

  // ── Reactive state (Svelte 5 runes) ───────────────────────────────────────
  let uh         = $state<UHState>({});
  let proj       = $state<PTProject | null>(null);
  let day        = $state<PTDay | null>(null);
  let crewCounts = $state<PersonCounts>({ cast: 0, crew: 0, total: 0 });
  let forecast   = $state<DailyForecast | null>(null);
  let loading    = $state(true);

  // Address resolution
  let usedQuery       = $state<string>('');     // what we successfully geocoded
  let geocodeResult   = $state<GeocodeResult | null>(null);  // what came back from the API
  let geocodeErr      = $state<string | null>(null);
  let forecastOverride = $state<string>('');    // user-supplied override address
  let overrideEdit    = $state<string>('');     // text being typed in override input
  let overrideMode    = $state(false);          // showing override UI?

  // Hospital + clipboard
  let hospital     = $state<string>('');
  let hospitalSaved = $state(false);
  let copyToast    = $state<string>('');

  // Re-derive everything from sync state.
  function refresh() {
    uh         = data.readUH();
    proj       = data.activeProject();
    day        = data.lastDay();
    crewCounts = data.counts();
    hospital   = sync.get('settools_hospital_note') ?? '';
    forecastOverride = sync.get('settools_forecast_address') ?? '';
  }

  // The address we'll use for maps + hospital + forecast.
  // Override beats UH location. Falls back to UH location.
  let effectiveAddress = $derived(
    forecastOverride.trim() || uh.location?.trim() || ''
  );

  // Lunch time = call time + 6h
  let lunchTime = $derived(data.computeLunch(uh.callTime));

  // ── Geocode + forecast whenever effective address changes ─────────────────
  let lastGeocoded = '';
  async function loadForecast() {
    const loc = effectiveAddress;
    if (!loc || loc === lastGeocoded) return;
    lastGeocoded = loc;
    geocodeErr = null;
    forecast = null;
    usedQuery = '';
    geocodeResult = null;
    try {
      const g = await smartGeocode(loc);
      if (!g) {
        geocodeErr = `Couldn't find "${loc}" — try a more specific address below`;
        return;
      }
      usedQuery = g.usedQuery;
      geocodeResult = g.result;
      const f = await getForecast(g.result.latitude, g.result.longitude, 3);
      forecast = f[1] ?? f[0] ?? null;  // [1] = tomorrow
    } catch (e) {
      geocodeErr = e instanceof Error ? e.message : String(e);
    }
  }

  // Human label for what we actually geocoded to. Lets the user spot a
  // wrong-place match (e.g., "Sunset Blvd" → a town in Australia).
  let resolvedLabel = $derived(() => {
    if (!geocodeResult) return '';
    const parts = [geocodeResult.name, geocodeResult.admin1, geocodeResult.country].filter(Boolean);
    return parts.join(', ');
  });

  $effect(() => {
    if (effectiveAddress) loadForecast();
  });

  // ── Persistence helpers ──────────────────────────────────────────────────
  async function saveHospital() {
    await sync.set('settools_hospital_note', hospital);
    hospitalSaved = true;
    setTimeout(() => { hospitalSaved = false; }, 1800);
  }

  async function saveOverride() {
    const v = overrideEdit.trim();
    if (!v) {
      await sync.set('settools_forecast_address', '');
      forecastOverride = '';
    } else {
      await sync.set('settools_forecast_address', v);
      forecastOverride = v;
    }
    overrideMode = false;
    overrideEdit = '';
    lastGeocoded = '';  // force re-fetch
  }

  async function resetOverride() {
    await sync.set('settools_forecast_address', '');
    forecastOverride = '';
    overrideMode = false;
    lastGeocoded = '';
  }

  function beginOverrideEdit() {
    overrideEdit = forecastOverride || uh.location || '';
    overrideMode = true;
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyToast = `Copied ${label} link`;
    } catch {
      // Fallback: use a temporary textarea
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      copyToast = `Copied ${label} link`;
    }
    setTimeout(() => { copyToast = ''; }, 1800);
  }

  onMount(async () => {
    await sync.init();
    refresh();
    sync.subscribe(refresh);
    loading = false;
  });

  let tomorrowLabel = $derived(data.tomorrowLabel());
</script>

<section class="briefing">
  <header class="hdr">
    <div class="hdr-l">
      <div class="hdr-eyebrow">TOMORROW · {tomorrowLabel.toUpperCase()}</div>
      <h1>{proj?.name ?? 'No active project'}</h1>
      {#if uh.episode || uh.director || day}
        <div class="hdr-meta">
          {#if uh.episode}<span>Ep {uh.episode}</span>{/if}
          {#if uh.director}<span>· Dir {uh.director}</span>{/if}
          {#if day}<span>· Day {day.dayNum}</span>{/if}
        </div>
      {/if}
    </div>
    <div class="hdr-r">
      <a href="/index.html" class="back">← Set Tools</a>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading briefing…</div>
  {:else}
    <div class="grid">

      <!-- Weather -->
      <article class="card weather">
        <div class="card-eyebrow">Weather</div>
        {#if !effectiveAddress}
          <div class="empty">Set a shoot location in Crew Tracker to see the forecast.</div>
        {:else if forecast}
          <div class="weather-main">
            <div class="temps">
              <span class="temp-hi">{forecast.tempHi}°</span>
              <span class="temp-sep">/</span>
              <span class="temp-lo">{forecast.tempLo}°</span>
            </div>
            <div class="condition">{wmoLabel(forecast.weatherCode)}</div>
          </div>
          {#if forecast.precipitationProb != null}
            <div class="weather-detail">Precip {forecast.precipitationProb}% chance</div>
          {/if}
          <div class="weather-detail dim">Forecasting for: <strong>{resolvedLabel()}</strong></div>
          {#if geocodeResult}
            <div class="weather-detail dim small">
              <a href={`https://www.openstreetmap.org/?mlat=${geocodeResult.latitude}&mlon=${geocodeResult.longitude}&zoom=14`} target="_blank" rel="noopener">
                verify on map ({geocodeResult.latitude.toFixed(3)}, {geocodeResult.longitude.toFixed(3)})
              </a>
            </div>
          {/if}
          <button class="text-btn" onclick={beginOverrideEdit}>
            {forecastOverride ? 'Change override' : 'Wrong place? Override'}
          </button>
          {#if forecastOverride}
            <button class="text-btn dim" onclick={resetOverride}>Reset to call sheet</button>
          {/if}
        {:else if geocodeErr}
          <div class="empty err">{geocodeErr}</div>
          {#if !overrideMode}
            <button class="text-btn" onclick={beginOverrideEdit}>Enter address manually</button>
          {/if}
        {:else}
          <div class="empty">Fetching forecast…</div>
        {/if}

        {#if overrideMode}
          <div class="override-form">
            <label for="override-input">Forecast address (used only for weather + maps lookup)</label>
            <input
              id="override-input"
              type="text"
              bind:value={overrideEdit}
              placeholder="e.g. 1234 Sunset Blvd, Los Angeles, CA 90028"
            />
            <div class="override-actions">
              <button onclick={saveOverride}>Save</button>
              <button class="ghost" onclick={() => overrideMode = false}>Cancel</button>
            </div>
          </div>
        {/if}
      </article>

      <!-- Solar -->
      <article class="card solar">
        <div class="card-eyebrow">Sun</div>
        {#if forecast}
          <div class="solar-row">
            <div><span class="lbl">Civil dawn</span><span class="val">{fmtTime12(forecast.civilDawn ?? forecast.sunrise)}</span></div>
            <div><span class="lbl">Sunrise</span><span class="val accent">{fmtTime12(forecast.sunrise)}</span></div>
            <div><span class="lbl">Sunset</span><span class="val accent">{fmtTime12(forecast.sunset)}</span></div>
            <div><span class="lbl">Civil dusk</span><span class="val">{fmtTime12(forecast.civilDusk ?? forecast.sunset)}</span></div>
          </div>
        {:else}
          <div class="empty">Sun times will appear once the forecast loads.</div>
        {/if}
      </article>

      <!-- Logistics -->
      <article class="card logistics">
        <div class="card-eyebrow">Logistics</div>
        <div class="kv">
          <div class="kv-row"><span class="kv-k">Call</span><span class="kv-v">{uh.callTime ?? '—'}</span></div>
          <div class="kv-row"><span class="kv-k">First Shot</span><span class="kv-v">{uh.firstShot ?? '—'}</span></div>
          <div class="kv-row"><span class="kv-k">Lunch (+6h)</span><span class="kv-v">{lunchTime ?? '—'}</span></div>
          <div class="kv-row"><span class="kv-k">Script v.</span><span class="kv-v">{proj?.scriptVersion ?? '—'}</span></div>
          <div class="kv-row"><span class="kv-k">Schedule v.</span><span class="kv-v">{proj?.scheduleVersion ?? '—'}</span></div>
        </div>
      </article>

      <!-- People counts -->
      <article class="card counts">
        <div class="card-eyebrow">People</div>
        <div class="counts-grid">
          <div><span class="big">{crewCounts.cast}</span><span class="lbl">Cast</span></div>
          <div><span class="big">{crewCounts.crew}</span><span class="lbl">Crew</span></div>
          <div><span class="big">{crewCounts.total}</span><span class="lbl">Total</span></div>
        </div>
      </article>

      <!-- Maps + hospital -->
      <article class="card maps">
        <div class="card-eyebrow">Location</div>
        {#if effectiveAddress}
          <div class="map-addr">{effectiveAddress}</div>
          <div class="map-links">
            <div class="map-link-row">
              <a class="map-link" href={googleMapsUrl(effectiveAddress)} target="_blank" rel="noopener">📍 Google Maps</a>
              <button class="copy-btn" title="Copy Google Maps link" onclick={() => copyText(googleMapsUrl(effectiveAddress), 'Google Maps')}>📋</button>
            </div>
            <div class="map-link-row">
              <a class="map-link" href={appleMapsUrl(effectiveAddress)} target="_blank" rel="noopener">🍎 Apple Maps</a>
              <button class="copy-btn" title="Copy Apple Maps link" onclick={() => copyText(appleMapsUrl(effectiveAddress), 'Apple Maps')}>📋</button>
            </div>
          </div>
          <div class="hospital">
            <div class="hospital-row">
              <label for="hospital-note">Nearest hospital</label>
              {#if hospitalSaved}<span class="saved-indicator">✓ saved</span>{/if}
            </div>
            <input
              id="hospital-note"
              type="text"
              bind:value={hospital}
              onblur={saveHospital}
              placeholder="e.g. Cedars-Sinai, 8700 Beverly Blvd"
            />
            <div class="hospital-links">
              {#if hospital}
                <a class="link-out" href={googleMapsUrl(hospital)} target="_blank" rel="noopener">Open route →</a>
                <button class="copy-btn" title="Copy hospital route" onclick={() => copyText(googleMapsUrl(hospital), 'Hospital')}>📋</button>
              {:else}
                <a class="link-out" href={nearestHospitalUrl(effectiveAddress)} target="_blank" rel="noopener">Find nearest →</a>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty">Set a shoot location in Crew Tracker.</div>
        {/if}
      </article>

    </div>
  {/if}

  {#if copyToast}
    <div class="toast" role="status">{copyToast}</div>
  {/if}
</section>

<style>
  .briefing { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; position: relative; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 28px; flex-wrap: wrap; }
  .hdr-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
  .hdr-l h1 { font-family: var(--cond); font-size: 32px; font-weight: 700; letter-spacing: 0.04em; color: var(--text); line-height: 1.05; }
  .hdr-meta { display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--mono); font-size: 12px; color: var(--text2); margin-top: 6px; }
  .back { font-family: var(--mono); font-size: 12px; color: var(--text2); text-decoration: none; padding: 8px 14px; border: 1px solid var(--border); border-radius: 6px; }
  .back:hover { color: var(--accent); border-color: var(--accent); }

  .loading { text-align: center; padding: 60px; color: var(--text2); font-family: var(--mono); }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }

  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; min-height: 140px; }
  .card-eyebrow { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text3); margin-bottom: 12px; }

  .empty { font-size: 13px; color: var(--text3); padding: 8px 0; }
  .empty.err { color: var(--warn); }

  /* Weather */
  .weather-main { display: flex; flex-direction: column; gap: 4px; }
  .temps { font-family: var(--mono); display: flex; align-items: baseline; gap: 6px; }
  .temp-hi { font-size: 38px; font-weight: 700; color: var(--text); }
  .temp-sep { font-size: 24px; color: var(--text3); }
  .temp-lo { font-size: 24px; color: var(--text2); }
  .condition { font-size: 16px; color: var(--text2); font-weight: 500; }
  .weather-detail { font-size: 12px; color: var(--text2); margin-top: 8px; }
  .weather-detail.dim { color: var(--text3); font-style: italic; word-break: break-word; }
  .weather-detail.dim strong { color: var(--text2); font-style: normal; font-weight: 600; }
  .weather-detail.small { font-size: 10.5px; margin-top: 2px; }
  .weather-detail.small a { color: var(--text3); text-decoration: underline; text-underline-offset: 2px; }
  .weather-detail.small a:hover { color: var(--accent); }

  .text-btn { background: none; border: none; color: var(--accent); font-family: var(--mono); font-size: 11px; padding: 4px 0; margin-top: 6px; margin-right: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .text-btn:hover { color: var(--accent2); }
  .text-btn.dim { color: var(--text3); }
  .text-btn.dim:hover { color: var(--text2); }

  .override-form { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .override-form label { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .override-form input { font-family: var(--mono); font-size: 13px; padding: 7px 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
  .override-form input:focus { outline: none; border-color: var(--accent); }
  .override-actions { display: flex; gap: 8px; margin-top: 4px; }
  .override-actions button { font-family: var(--font); font-size: 12px; padding: 5px 12px; border-radius: 4px; cursor: pointer; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); font-weight: 600; }
  .override-actions button:hover { background: var(--accent2); }
  .override-actions button.ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .override-actions button.ghost:hover { color: var(--text); border-color: var(--text2); }

  /* Solar */
  .solar-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
  .solar-row > div { display: flex; flex-direction: column; gap: 2px; }
  .lbl { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .val { font-family: var(--mono); font-size: 15px; color: var(--text); }
  .val.accent { color: var(--accent); font-weight: 600; }

  /* Logistics */
  .kv { display: flex; flex-direction: column; gap: 6px; }
  .kv-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .kv-row:last-child { border-bottom: none; }
  .kv-k { font-family: var(--mono); font-size: 11px; color: var(--text2); }
  .kv-v { font-family: var(--mono); font-size: 14px; color: var(--text); font-weight: 500; }

  /* Counts */
  .counts-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding-top: 6px; }
  .counts-grid > div { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; }
  .big { font-family: var(--cond); font-size: 36px; font-weight: 700; color: var(--accent); line-height: 1; }
  .counts-grid .lbl { font-size: 11px; }

  /* Maps */
  .map-addr { font-size: 13px; color: var(--text); margin-bottom: 10px; word-break: break-word; }
  .map-links { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .map-link-row { display: flex; gap: 6px; align-items: center; }
  .map-link { flex: 1; font-family: var(--mono); font-size: 12px; color: var(--text2); text-decoration: none; padding: 7px 12px; border: 1px solid var(--border); border-radius: 4px; transition: all .12s; }
  .map-link:hover { color: var(--accent); border-color: var(--accent); background: var(--bg3); }
  .copy-btn { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; color: var(--text2); padding: 6px 10px; cursor: pointer; font-size: 14px; transition: all .12s; }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--bg4); }

  .hospital { display: flex; flex-direction: column; gap: 4px; }
  .hospital-row { display: flex; justify-content: space-between; align-items: baseline; }
  .hospital label { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .saved-indicator { font-family: var(--mono); font-size: 10px; color: var(--success); letter-spacing: 0.05em; animation: fadein .2s ease; }
  @keyframes fadein { from { opacity: 0; } to { opacity: 1; } }
  .hospital input { font-family: var(--mono); font-size: 13px; padding: 6px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
  .hospital input:focus { outline: none; border-color: var(--accent); }
  .hospital-links { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
  .link-out { flex: 1; font-family: var(--mono); font-size: 11px; color: var(--accent); text-decoration: none; padding: 2px 0; }
  .link-out:hover { text-decoration: underline; }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg3);
    color: var(--success);
    border: 1px solid var(--success);
    padding: 10px 18px;
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 12px;
    z-index: 1000;
    animation: slidein .2s ease;
    box-shadow: 0 4px 14px rgba(0,0,0,.4);
  }
  @keyframes slidein { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
</style>
