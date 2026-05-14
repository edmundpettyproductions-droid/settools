<script lang="ts">
  import { onMount } from 'svelte';
  import * as sync from '../lib/sync';
  import * as data from '../lib/data';
  import { geocode, getForecast, wmoLabel, fmtTime12 } from '../lib/weather';
  import { googleMapsUrl, appleMapsUrl, nearestHospitalUrl } from '../lib/url';
  import type { DailyForecast, UHState, PTProject, PTDay, PersonCounts } from '../lib/types';

  // ── Reactive state (Svelte 5 runes) ───────────────────────────────────────
  let uh         = $state<UHState>({});
  let proj       = $state<PTProject | null>(null);
  let day        = $state<PTDay | null>(null);
  let crewCounts = $state<PersonCounts>({ cast: 0, crew: 0, total: 0 });
  let forecast   = $state<DailyForecast | null>(null);
  let loading    = $state(true);
  let geocodeErr = $state<string | null>(null);
  let hospital   = $state<string>('');

  // Re-derive everything from sync state.
  function refresh() {
    uh         = data.readUH();
    proj       = data.activeProject();
    day        = data.lastDay();
    crewCounts = data.counts();
    hospital   = sync.get('settools_hospital_note') ?? '';
  }

  // Lunch time = call time + 6h
  let lunchTime = $derived(data.computeLunch(uh.callTime));

  // ── Geocode + forecast whenever location changes ──────────────────────────
  let lastGeocodedLocation = '';
  async function loadForecast() {
    const loc = (uh.location ?? '').trim();
    if (!loc || loc === lastGeocodedLocation) return;
    lastGeocodedLocation = loc;
    geocodeErr = null;
    try {
      const g = await geocode(loc);
      if (!g) {
        geocodeErr = `Couldn't find "${loc}" — try a more specific address`;
        forecast = null;
        return;
      }
      const f = await getForecast(g.latitude, g.longitude, 3);
      // [0] = today, [1] = tomorrow
      forecast = f[1] ?? f[0] ?? null;
    } catch (e) {
      geocodeErr = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    // Re-run whenever uh.location changes
    if (uh.location) loadForecast();
  });

  // ── Hospital field is a manual note for now, synced like everything else ──
  async function saveHospital() {
    await sync.set('settools_hospital_note', hospital);
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
      {#if uh.episode || uh.director}
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
        {#if geocodeErr}
          <div class="empty">{geocodeErr}</div>
        {:else if !uh.location}
          <div class="empty">Set a shoot location in Crew Tracker to see the forecast.</div>
        {:else if !forecast}
          <div class="empty">Fetching forecast for {uh.location}…</div>
        {:else}
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
          <div class="weather-detail dim">{uh.location}</div>
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
          <div class="empty">No forecast yet.</div>
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
        {#if uh.location}
          <div class="map-addr">{uh.location}</div>
          <div class="map-links">
            <a href={googleMapsUrl(uh.location)} target="_blank" rel="noopener">📍 Google Maps</a>
            <a href={appleMapsUrl(uh.location)} target="_blank" rel="noopener">🍎 Apple Maps</a>
          </div>
          <div class="hospital">
            <label for="hospital-note">Nearest hospital</label>
            <input
              id="hospital-note"
              type="text"
              bind:value={hospital}
              onblur={saveHospital}
              placeholder="e.g. Cedars-Sinai, 8700 Beverly Blvd"
            />
            {#if hospital}
              <a class="link-out" href={googleMapsUrl(hospital)} target="_blank" rel="noopener">Open route →</a>
            {:else}
              <a class="link-out" href={nearestHospitalUrl(uh.location)} target="_blank" rel="noopener">Find one →</a>
            {/if}
          </div>
        {:else}
          <div class="empty">Set a shoot location in Crew Tracker.</div>
        {/if}
      </article>

    </div>
  {/if}
</section>

<style>
  /* Local component styles. Color tokens live in app.css. */
  .briefing { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
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

  .empty { font-size: 13px; color: var(--text3); padding: 14px 0; }

  /* Weather */
  .weather-main { display: flex; flex-direction: column; gap: 4px; }
  .temps { font-family: var(--mono); display: flex; align-items: baseline; gap: 6px; }
  .temp-hi { font-size: 38px; font-weight: 700; color: var(--text); }
  .temp-sep { font-size: 24px; color: var(--text3); }
  .temp-lo { font-size: 24px; color: var(--text2); }
  .condition { font-size: 16px; color: var(--text2); font-weight: 500; }
  .weather-detail { font-size: 12px; color: var(--text2); margin-top: 8px; }
  .weather-detail.dim { color: var(--text3); font-style: italic; }

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
  .map-addr { font-size: 13px; color: var(--text); margin-bottom: 8px; }
  .map-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .map-links a { font-family: var(--mono); font-size: 11px; color: var(--text2); text-decoration: none; padding: 5px 10px; border: 1px solid var(--border); border-radius: 4px; }
  .map-links a:hover { color: var(--accent); border-color: var(--accent); }
  .hospital { display: flex; flex-direction: column; gap: 4px; }
  .hospital label { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .hospital input { font-family: var(--mono); font-size: 13px; padding: 6px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
  .hospital input:focus { outline: none; border-color: var(--accent); }
  .link-out { font-family: var(--mono); font-size: 11px; color: var(--accent); text-decoration: none; align-self: flex-start; margin-top: 2px; }
  .link-out:hover { text-decoration: underline; }
</style>
