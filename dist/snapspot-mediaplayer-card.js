class SnapspotMediaplayerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config     = null;
    this._hass       = null;
    this._activeId   = null;
    this._bgColor    = null;
    this._lastArt    = null;
    this._cardH      = 200;
    this._resizeObs  = null;
    // DSP / EQ canvas state
    this._dspCanvas  = null;
    this._dspCtx     = null;
    this._dspBands   = [];
    this._dspDragging = null;
    this._dspEditMode = false;
  }

  connectedCallback() {
    this._attachObserver();
  }

  disconnectedCallback() {
    if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: 'media_player',
          required: true,
          selector: { entity: { domain: ['media_player'] } },
        },
        {
          name: 'show_dsp',
          required: false,
          selector: { boolean: {} },
        },
        {
          name: 'title',
          required: false,
          selector: { text: {} },
        },
        {
          name: 'source_switch',
          required: false,
          selector: {
            select: {
              options: [
                { value: 'auto',   label: 'Auto – follow the playing source' },
                { value: 'manual', label: 'Manual – show switcher bar' },
              ],
              mode: 'list',
            },
          },
        },
      ],
      computeLabel: (s) => ({
        media_player:  'Media Player (Snapcast or Spotify)',
        show_dsp:      'Show DSP / EQ section',
        title:         'Card title (optional)',
        source_switch: 'Source switching',
      }[s.name] || s.name),
    };
  }

  static getStubConfig() {
    return { media_player: '', show_dsp: false, title: '', source_switch: 'auto' };
  }

  _prefix(id) {
    return id.split('.')[1].replace(/_snapcast$/, '').replace(/_spotify$/, '');
  }

  _source(id) {
    if (id.endsWith('_snapcast')) return 'snapcast';
    if (id.endsWith('_spotify'))  return 'spotify';
    return 'unknown';
  }

  _companionId(id) {
    if (id.endsWith('_snapcast')) return id.replace(/_snapcast$/, '_spotify');
    if (id.endsWith('_spotify'))  return id.replace(/_spotify$/, '_snapcast');
    return null;
  }

  _eid(activeId, domain, suffix) {
    return `${domain}.${this._prefix(activeId)}_${suffix}`;
  }

  _state(entityId) {
    return (this._hass && entityId) ? (this._hass.states[entityId] || null) : null;
  }

  setConfig(config) {
    this._config    = config;
    this._activeId  = config.media_player || null;
    this._dspCanvas = null; // force re-init after re-render
    this._dspCtx    = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._activeId && this._config?.media_player) {
      this._activeId = this._config.media_player;
    }
    // Auto mode: follow whichever companion is playing
    if (this._activeId && this._config?.source_switch !== 'manual') {
      const companionId = this._companionId(this._activeId);
      if (companionId) {
        const companion = hass.states[companionId];
        const current   = hass.states[this._activeId];
        if (companion?.state === 'playing' && current?.state !== 'playing') {
          this._activeId = companionId;
        } else if (current?.state !== 'playing' && companion?.state !== 'playing') {
          // Neither playing – stay on configured default
          this._activeId = this._config.media_player || this._activeId;
        }
      }
    }
    this._update();
  }

  getCardSize() { return 3; }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; position: relative; }

        /* Part 1 — player area wrapper (constrains bg layers so they don't bleed into Part 2) */
        #playerWrap { position: relative; overflow: hidden; }

        /* Background layers */
        .bg-color {
          position: absolute; inset: 0;
          transition: background 0.8s;
        }
        .bg-image {
          position: absolute; top: 0; right: 0; bottom: 0;
          background-size: cover; background-position: center;
          background-repeat: no-repeat;
          opacity: 0;
          transition: opacity 0.8s, background-image 0.8s, width 0.8s;
        }
        .bg-gradient {
          position: absolute; top: 0; right: 0; bottom: 0;
          opacity: 0;
          transition: background 0.8s, opacity 0.4s, width 0.8s;
        }

        /* Player content */
        .player {
          position: relative; z-index: 1;
          padding: 14px 16px 10px;
          min-height: 200px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .player.has-art { color: #fff; }
        .player.no-art  { color: var(--primary-text-color); }
        /* Top row */
        .top-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .source-badge {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          padding: 2px 7px; border-radius: 10px; text-transform: uppercase; flex-shrink: 0;
        }
        .player.no-art  .source-badge          { background: var(--primary-color,#03a9f4); color: #fff; }
        .player.no-art  .source-badge.spotify  { background: #1db954; }
        .player.has-art .source-badge          { background: rgba(255,255,255,0.22); color: #fff; }
        .player.has-art .source-badge.spotify  { background: rgba(29,185,84,0.75); }
        .device-name {
          font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .player.has-art .device-name { color: rgba(255,255,255,0.75); }
        .player.no-art  .device-name { color: var(--secondary-text-color,#888); }
        .track-title {
          font-size: 15px; font-weight: 600;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.3; margin-bottom: 2px;
        }
        .player.has-art .track-title { color: #fff; }
        .player.no-art  .track-title { color: var(--primary-text-color); }
        .track-sub {
          font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .player.has-art .track-sub { color: rgba(255,255,255,0.75); }
        .player.no-art  .track-sub { color: var(--secondary-text-color,#888); }
        /* Controls */
        .controls-row { display: flex; align-items: center; margin-top: 8px; margin-left: -8px; }
        .btn {
          background: none; border: none; cursor: pointer;
          padding: 4px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.15s;
        }
        .player.has-art .btn       { color: #fff; }
        .player.has-art .btn:hover { background: rgba(255,255,255,0.15); }
        .player.no-art  .btn       { color: var(--primary-text-color); }
        .player.no-art  .btn:hover { background: rgba(128,128,128,0.15); }
        .btn svg { fill: currentColor; display: block; }
        .btn.play  svg { width: 32px; height: 32px; }
        .btn.small svg { width: 20px; height: 20px; }
        .vol-wrap { flex: 1; display: flex; align-items: center; gap: 2px; margin-left: 4px; }
        .vol-slider {
          flex: 1; -webkit-appearance: none; height: 3px; border-radius: 2px;
          outline: none; cursor: pointer; min-width: 0;
        }
        .vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; cursor: pointer;
        }
        .player.has-art .vol-slider::-webkit-slider-thumb { background: #fff; }
        .player.no-art  .vol-slider::-webkit-slider-thumb { background: var(--primary-color,#03a9f4); }
        /* Progress */
        .progress-wrap { margin-top: 6px; }
        .progress-bg { width: 100%; height: 3px; border-radius: 2px; overflow: hidden; }
        .player.has-art .progress-bg { background: rgba(255,255,255,0.25); }
        .player.no-art  .progress-bg { background: var(--divider-color,#444); }
        .progress-bar { height: 100%; border-radius: 2px; transition: width 1s linear; }
        .player.has-art .progress-bar { background: #fff; }
        .player.no-art  .progress-bar { background: var(--primary-color,#03a9f4); }
        .progress-times { display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; }
        .player.has-art .progress-times { color: rgba(255,255,255,0.65); }
        .player.no-art  .progress-times { color: var(--secondary-text-color,#888); }

        /* Companion bar */
        .companion-bar { display: flex; position: relative; z-index: 1; }
        .has-art-ctx .companion-bar { border-top: 1px solid rgba(255,255,255,0.15); }
        .no-art-ctx  .companion-bar { border-top: 1px solid var(--divider-color,rgba(128,128,128,0.2)); }
        .comp-btn {
          flex: 1; padding: 7px 0;
          background: none; border: none; cursor: pointer;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          transition: color 0.15s, background 0.15s;
        }
        .has-art-ctx .comp-btn                  { color: rgba(255,255,255,0.45); }
        .has-art-ctx .comp-btn.active           { color: #fff; }
        .has-art-ctx .comp-btn.active.spotify   { color: #1db954; }
        .has-art-ctx .comp-btn:hover:not(.active) { background: rgba(255,255,255,0.06); }
        .no-art-ctx  .comp-btn                  { color: var(--secondary-text-color,#888); }
        .no-art-ctx  .comp-btn.active           { color: var(--primary-color,#03a9f4); background: rgba(3,169,244,0.06); }
        .no-art-ctx  .comp-btn.active.spotify   { color: #1db954; background: rgba(29,185,84,0.06); }
        .no-art-ctx  .comp-btn:hover:not(.active) { background: rgba(128,128,128,0.10); }
        .comp-divider { width: 1px; align-self: stretch; }
        .has-art-ctx .comp-divider { background: rgba(255,255,255,0.15); }
        .no-art-ctx  .comp-divider { background: var(--divider-color,rgba(128,128,128,0.2)); }

        .idle-wrap {
          padding: 24px 16px; text-align: center; font-size: 13px;
          color: var(--secondary-text-color,#888); position: relative; z-index: 1;
        }

        /* ── DSP / EQ section ──────────────────────────────────── */
        #dspSection {
          position: relative; z-index: 1; display: none;
          background: #1c1c1c;
          border-top: 1px solid rgba(128,128,128,0.25);
          padding: 10px 12px 12px;
        }
        #dspSection.visible { display: block; }
        .dsp-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .dsp-title {
          font-size: 10px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: #888;
        }
        .dsp-switches { display: flex; gap: 10px; align-items: center; }
        .dsp-sw-wrap  { display: flex; align-items: center; gap: 5px; }
        .dsp-sw-label { font-size: 10px; color: #888; white-space: nowrap; }
        .dsp-toggle {
          position: relative; width: 32px; height: 18px;
          background: #4a4a4a; border-radius: 9px; cursor: pointer;
          transition: background 0.2s; flex-shrink: 0;
        }
        .dsp-toggle.on { background: #22ba00; }
        .dsp-toggle::after {
          content: ''; position: absolute;
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff; top: 2px; left: 2px; transition: left 0.2s;
        }
        .dsp-toggle.on::after { left: 16px; }
        .dsp-canvas-wrap {
          width: 100%; height: 180px;
          user-select: none; touch-action: none;
        }
        .dsp-canvas-wrap canvas { width: 100%; height: 100%; display: block; }
      </style>
      <ha-card>
        <!-- Part 1: player area — bg layers are contained here and don't bleed into Part 2 -->
        <div id="playerWrap">
          <div class="bg-color" id="bgColor"></div>
          <div class="bg-image" id="bgImage"></div>
          <div class="bg-gradient" id="bgGradient"></div>
          <div id="root"></div>
        </div>
        <!-- Part 2: DSP / EQ section -->
        <div id="dspSection">
          <div class="dsp-header">
            <span class="dsp-title">Equalizer</span>
            <div class="dsp-switches">
              <div class="dsp-sw-wrap">
                <span class="dsp-sw-label">DAC</span>
                <div class="dsp-toggle" id="dspDac"></div>
              </div>
              <div class="dsp-sw-wrap">
                <span class="dsp-sw-label">DSP</span>
                <div class="dsp-toggle" id="dspHwEq"></div>
              </div>
              <div class="dsp-sw-wrap">
                <span class="dsp-sw-label">SW EQ</span>
                <div class="dsp-toggle" id="dspSwEq"></div>
              </div>
              <div class="dsp-sw-wrap">
                <span class="dsp-sw-label">Edit</span>
                <div class="dsp-toggle" id="dspEdit"></div>
              </div>
            </div>
          </div>
          <div class="dsp-canvas-wrap"><canvas id="dspCanvas"></canvas></div>
        </div>
      </ha-card>
    `;
    this._attachObserver();
    if (this._hass) this._update();
  }

  _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  _extractArtColor(imgUrl, callback) {
    if (!imgUrl) { callback(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Downsample to 80x80 — enough resolution without being slow
        const SIZE = 80;
        const c = document.createElement('canvas');
        c.width = SIZE; c.height = SIZE;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const d = ctx.getImageData(0, 0, SIZE, SIZE).data;

        // HSL bucketing — same principle as node-vibrant used by HA.
        // Sort pixels by hue (12 × 30° buckets), weight by saturation.
        // Skip near-black, near-white, and near-grey pixels.
        const HUE_BUCKETS = 12;
        const buckets = new Array(HUE_BUCKETS).fill(null).map(() => ({ r:0, g:0, b:0, w:0 }));

        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255, g = d[i+1] / 255, b = d[i+2] / 255;
          const max = Math.max(r,g,b), min = Math.min(r,g,b);
          const l = (max + min) / 2;
          if (l < 0.08 || l > 0.93) continue;          // skip very dark / very light
          const delta = max - min;
          if (delta < 0.12) continue;                   // skip near-grey
          const s = delta / (1 - Math.abs(2*l - 1));
          if (s < 0.25) continue;                       // skip low-saturation

          // Hue 0–360°
          let h;
          if (max === r)      h = ((g - b) / delta) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else                h = (r - g) / delta + 4;
          h = ((h * 60) + 360) % 360;

          const bi = Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
          const weight = s * (1 - Math.abs(2*l - 1)); // saturation × inverted-L-peak
          buckets[bi].r += d[i]   * weight;
          buckets[bi].g += d[i+1] * weight;
          buckets[bi].b += d[i+2] * weight;
          buckets[bi].w += weight;
        }

        // Pick the most populated / vibrant bucket
        const best = buckets.reduce((a, b) => b.w > a.w ? b : a);
        if (best.w < 1) { callback(null); return; }    // no vibrant pixels found

        // Weighted average RGB for this hue bucket — then darken to ~L 0.28
        // (matches HA's media-control-card aesthetic)
        let br = best.r / best.w, bg2 = best.g / best.w, bb = best.b / best.w;
        const maxC = Math.max(br,bg2,bb);
        if (maxC > 0) {
          const target = 71; // target max channel ≈ L 0.28
          const scale = Math.min(1, target / maxC);
          br *= scale; bg2 *= scale; bb *= scale;
        }
        callback('rgb(' + Math.round(br) + ',' + Math.round(bg2) + ',' + Math.round(bb) + ')');
      } catch(e) {
        // Canvas tainted (CORS) — fall back silently
        callback(null);
      }
    };
    img.onerror = () => callback(null);
    img.src = imgUrl;
  }

  _applyBackground(artUrl, color) {
    const bgColor = this.shadowRoot.querySelector('#bgColor');
    const bgImage = this.shadowRoot.querySelector('#bgImage');
    const bgGrad  = this.shadowRoot.querySelector('#bgGradient');
    if (!bgColor) return;
    const hasArt = artUrl && artUrl !== 'unavailable' && artUrl !== 'unknown';
    const col = color || 'rgb(26,26,26)';
    if (hasArt) {
      // Extract r,g,b so we can build valid rgba() gradient stops.
      // col is always 'rgb(r,g,b)' from _extractArtColor, never hex, but handle both.
      let r = 26, g = 26, b = 26;
      const m = col.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
      // Gradient: dominant color → transparent (left→right), same width as artwork.
      // Mirrors the HA hui-media-control-card color-gradient approach exactly.
      const cFull  = `rgba(${r},${g},${b},1)`;
      const cMid   = `rgba(${r},${g},${b},0.5)`;
      const cNone  = `rgba(${r},${g},${b},0)`;
      bgColor.style.background       = col;
      bgImage.style.backgroundImage  = `url(${artUrl})`;
      bgImage.style.width            = this._cardH + 'px';
      bgImage.style.opacity          = '1';
      bgGrad.style.background        = `linear-gradient(to right, ${cFull} 0%, ${cMid} 55%, ${cNone} 100%)`;
      bgGrad.style.width             = this._cardH + 'px';
      bgGrad.style.opacity           = '1';
    } else {
      bgColor.style.background = 'transparent';
      bgImage.style.opacity    = '0';
      bgGrad.style.opacity     = '0';
    }
  }

  _attachObserver() {
    if (this._resizeObs) return;
    // Observe #playerWrap (Part 1 only) so _cardH reflects the player height,
    // not the total card height which includes the DSP section (Part 2).
    const wrap = this.shadowRoot && this.shadowRoot.querySelector('#playerWrap');
    if (!wrap) return;
    this._resizeObs = new ResizeObserver(() => {
      if (wrap.offsetHeight) {
        this._cardH = wrap.offsetHeight;
        this._applyBackground(this._lastArt, this._bgColor);
      }
    });
    this._resizeObs.observe(wrap);
  }

  _update() {
    if (!this._config || !this._hass) return;
    const root = this.shadowRoot && this.shadowRoot.querySelector('#root');
    if (!root) return;

    const activeId = this._activeId;

    if (!activeId) {
      this._applyBackground(null, null);
      root.innerHTML = '<div class="idle-wrap">Select a media player entity in the card configuration.</div>';
      return;
    }

    const mp = this._state(activeId);
    if (!mp) {
      this._applyBackground(null, null);
      root.innerHTML = '<div class="idle-wrap">Entity not found:<br><small>' + this._esc(activeId) + '</small></div>';
      return;
    }

    const source   = this._source(activeId);
    const track    = this._state(this._eid(activeId, 'sensor', source + '_track'))?.state   || '';
    const artist   = this._state(this._eid(activeId, 'sensor', source + '_artist'))?.state  || '';
    const album    = this._state(this._eid(activeId, 'sensor', source + '_album'))?.state   || '';
    const duration = parseFloat(this._state(this._eid(activeId, 'sensor', source + '_duration'))?.state) || 0;
    const position = parseFloat(this._state(this._eid(activeId, 'sensor', source + '_position'))?.state) || 0;

    // Prefer HA proxy URL (same-origin) for artwork + color extraction
    const entityPic = mp.attributes?.entity_picture_local || mp.attributes?.entity_picture || '';
    const sensorArt = this._state(this._eid(activeId, 'sensor', source + '_art_url'))?.state || '';
    const artUrl    = entityPic || sensorArt;

    const mpState   = mp.state || 'unavailable';
    const volLevel  = mp.attributes?.volume_level ?? null;
    const isMuted   = mp.attributes?.is_volume_muted ?? false;
    const isPlaying = mpState === 'playing';
    const isActive  = isPlaying || mpState === 'paused' || mpState === 'buffering';

    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

    const hasArt = artUrl && artUrl !== 'unavailable' && artUrl !== 'unknown' && artUrl !== '';
    const volVal = volLevel != null ? Math.round(volLevel * 100) : 50;
    const deviceName = this._config.title || mp.attributes?.friendly_name || this._prefix(activeId);

    // Trigger background + color extraction only when artwork URL changes
    if (artUrl !== this._lastArt) {
      this._lastArt = artUrl;
      this._bgColor = null;
      this._applyBackground(hasArt ? artUrl : null, null);
      if (hasArt) {
        this._extractArtColor(artUrl, (color) => {
          this._bgColor = color;
          this._applyBackground(artUrl, color);
          this._updateVolSlider(color);
        });
      }
    } else {
      this._applyBackground(hasArt ? artUrl : null, this._bgColor);
    }

    const artCls = hasArt ? 'has-art' : 'no-art';
    const ctxCls = hasArt ? 'has-art-ctx' : 'no-art-ctx';
    const volGrad = 'linear-gradient(to right,'
      + (hasArt ? 'rgba(255,255,255,0.85)' : 'var(--primary-color,#03a9f4)') + ' ' + volVal + '%, '
      + (hasArt ? 'rgba(255,255,255,0.28)' : 'var(--divider-color,#444)')    + ' ' + volVal + '%)';

    // Only show prev/next for Spotify; Snapcast only gets play/pause
    const showNav = (source === 'spotify');

    const PLAY  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    const PREV  = '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>';
    const NEXT  = '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
    const VOL   = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    const MUTE  = '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18L19 19.27 20.27 18 5.27 3 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

    const companionId     = this._companionId(activeId);
    const companionExists = companionId && !!this._state(companionId);
    const companionSrc    = source === 'snapcast' ? 'spotify' : 'snapcast';

    const showManualBar = companionExists && this._config?.source_switch === 'manual';
    const companionHtml = showManualBar
      ? '<div class="companion-bar">'
        + '<button class="comp-btn active ' + source + '" id="btnSelf">' + source + '</button>'
        + '<div class="comp-divider"></div>'
        + '<button class="comp-btn ' + companionSrc + '" id="btnOther">' + companionSrc + '</button>'
        + '</div>'
      : '';

    const progressHtml = isActive
      ? '<div class="progress-wrap">'
        + '<div class="progress-bg"><div class="progress-bar" style="width:' + pct + '%"></div></div>'
        + '<div class="progress-times"><span>' + fmt(position) + '</span><span>' + (duration > 0 ? fmt(duration) : '') + '</span></div>'
        + '</div>'
      : '';

    root.innerHTML =
      '<div class="' + ctxCls + '">'
      + '<div class="player ' + artCls + '">'
      + '<div>'
      + '<div class="top-row">'
      + '<span class="source-badge ' + source + '">' + source + '</span>'
      + '<span class="device-name">' + this._esc(deviceName) + '</span>'
      + '</div>'
      + '<div class="track-title">' + this._esc(track || (isActive ? '\u2014' : mpState)) + '</div>'
      + '<div class="track-sub">'   + this._esc([artist, album].filter(Boolean).join(' \u00b7 ')) + '</div>'
      + '</div>'
      + '<div>'
      + '<div class="controls-row">'
      + (showNav ? '<button class="btn small" id="btnPrev">' + PREV + '</button>' : '')
      + '<button class="btn play" id="btnPlay">' + (isPlaying ? PAUSE : PLAY) + '</button>'
      + (showNav ? '<button class="btn small" id="btnNext">' + NEXT + '</button>' : '')
      + '<div class="vol-wrap">'
      + '<button class="btn small" id="btnMute">' + (isMuted ? MUTE : VOL) + '</button>'
      + '<input class="vol-slider" id="volSlider" type="range" min="0" max="100" value="' + volVal + '" style="background:' + volGrad + '">'
      + '</div>'
      + '</div>'
      + progressHtml
      + '</div>'
      + '</div>'
      + companionHtml
      + '</div>';

    root.querySelector('#btnPlay')?.addEventListener('click', () =>
      this._hass.callService('media_player', isPlaying ? 'media_pause' : 'media_play', { entity_id: activeId }));
    if (showNav) {
      root.querySelector('#btnPrev')?.addEventListener('click', () =>
        this._hass.callService('media_player', 'media_previous_track', { entity_id: activeId }));
      root.querySelector('#btnNext')?.addEventListener('click', () =>
        this._hass.callService('media_player', 'media_next_track', { entity_id: activeId }));
    }
    root.querySelector('#btnMute')?.addEventListener('click', () =>
      this._hass.callService('media_player', 'volume_mute', { entity_id: activeId, is_volume_muted: !isMuted }));

    const slider = root.querySelector('#volSlider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const v = e.target.value;
        e.target.style.background = 'linear-gradient(to right,'
          + (hasArt ? 'rgba(255,255,255,0.85)' : 'var(--primary-color,#03a9f4)') + ' ' + v + '%, '
          + (hasArt ? 'rgba(255,255,255,0.28)' : 'var(--divider-color,#444)') + ' ' + v + '%)';
      });
      slider.addEventListener('change', (e) =>
        this._hass.callService('media_player', 'volume_set', { entity_id: activeId, volume_level: parseInt(e.target.value, 10) / 100 }));
    }

    if (showManualBar) {
      root.querySelector('#btnOther')?.addEventListener('click', () => {
        this._activeId = companionId;
        this._update();
      });
    }

    this._dspUpdate();
  }

  // ── DSP / EQ integrated canvas ────────────────────────────────────────────

  // Scan hass.states dynamically — finds EQ bands regardless of padding chars in the entity ID
  // (HA slugifies friendly names, so "EQ ---25Hz" → _eq_25hz, "EQ --100Hz" → _eq_100hz etc.)
  _dspScanBands(prefix) {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter(eid => eid.startsWith(`number.${prefix}_eq_`) && /\d+hz?$/i.test(eid))
      .map(eid => {
        const m = eid.match(/(\d+)hz?$/i);
        if (!m) return null;
        const st = this._hass.states[eid];
        return { entityId: eid, freq: parseInt(m[1], 10), value: parseFloat(st.state) || 0 };
      })
      .filter(Boolean)
      .sort((a, b) => a.freq - b.freq);
  }

  _dspInit() {
    // Idempotent — run once per render cycle
    const canvas = this.shadowRoot && this.shadowRoot.querySelector('#dspCanvas');
    if (!canvas || this._dspCanvas === canvas) return;
    this._dspCanvas = canvas;
    this._dspCtx    = canvas.getContext('2d');

    canvas.addEventListener('mousedown',  this._dspPtrDown.bind(this));
    canvas.addEventListener('mousemove',  this._dspPtrMove.bind(this));
    canvas.addEventListener('mouseup',    this._dspPtrUp.bind(this));
    canvas.addEventListener('mouseleave', this._dspPtrUp.bind(this));
    canvas.addEventListener('touchstart', this._dspPtrDown.bind(this), { passive: false });
    canvas.addEventListener('touchmove',  this._dspPtrMove.bind(this), { passive: false });
    canvas.addEventListener('touchend',   this._dspPtrUp.bind(this));

    this.shadowRoot.querySelector('#dspEdit')?.addEventListener('click', () => {
      this._dspEditMode = !this._dspEditMode;
      this.shadowRoot.querySelector('#dspEdit')?.classList.toggle('on', this._dspEditMode);
      canvas.style.cursor = this._dspEditMode ? 'pointer' : 'default';
    });

    this.shadowRoot.querySelector('#dspSwEq')?.addEventListener('click', () => {
      if (!this._hass || !this._activeId) return;
      const eid = `switch.${this._prefix(this._activeId)}_software_eq`;
      if (this._hass.states[eid]) this._hass.callService('homeassistant', 'toggle', { entity_id: eid });
    });

    this.shadowRoot.querySelector('#dspDac')?.addEventListener('click', () => {
      if (!this._hass || !this._activeId) return;
      const eid = `switch.${this._prefix(this._activeId)}_dac`;
      if (this._hass.states[eid]) this._hass.callService('homeassistant', 'toggle', { entity_id: eid });
    });

    this.shadowRoot.querySelector('#dspHwEq')?.addEventListener('click', () => {
      if (!this._hass || !this._activeId) return;
      const eid = `select.${this._prefix(this._activeId)}_dsp`;
      const st = this._hass.states[eid];
      if (!st) return;
      const isOn = st.state && st.state !== 'Disabled' && st.state !== 'unavailable' && st.state !== 'unknown';
      this._hass.callService('select', 'select_option', {
        entity_id: eid,
        option: isOn ? 'Disabled' : (st.attributes?.options?.find(o => o !== 'Disabled') || st.state),
      });
    });
  }

  _dspUpdate() {
    const sec = this.shadowRoot && this.shadowRoot.querySelector('#dspSection');
    if (!sec) return;
    const show = !!this._config?.show_dsp;
    sec.classList.toggle('visible', show);
    if (!show || !this._activeId || !this._hass) return;

    this._dspInit();
    if (!this._dspCanvas) return;

    const prefix  = this._prefix(this._activeId);
    this._dspBands = this._dspScanBands(prefix);

    // Toggle states for header switches
    const swEqSt = this._hass.states[`switch.${prefix}_software_eq`];
    this.shadowRoot.querySelector('#dspSwEq')?.classList.toggle('on', swEqSt?.state === 'on');

    const dacSt = this._hass.states[`switch.${prefix}_dac`];
    this.shadowRoot.querySelector('#dspDac')?.classList.toggle('on', dacSt?.state === 'on');

    const hwEqSt = this._hass.states[`select.${prefix}_dsp`];
    const hwEqOn = hwEqSt && hwEqSt.state && hwEqSt.state !== 'Disabled' && hwEqSt.state !== 'unavailable' && hwEqSt.state !== 'unknown';
    this.shadowRoot.querySelector('#dspHwEq')?.classList.toggle('on', !!hwEqOn);

    // Size canvas to pixel dimensions (run every update — cheap if already right)
    const rect = this._dspCanvas.getBoundingClientRect();
    if (rect.width > 0) {
      const dpr = window.devicePixelRatio || 1;
      if (this._dspCanvas.width !== Math.round(rect.width * dpr)) {
        this._dspCanvas.width  = Math.round(rect.width  * dpr);
        this._dspCanvas.height = Math.round(rect.height * dpr);
        this._dspCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    this._dspDraw();
  }

  _dspDraw() {
    const ctx = this._dspCtx;
    if (!ctx || !this._dspCanvas) return;
    const r = this._dspCanvas.getBoundingClientRect();
    const w = r.width  || this._dspCanvas.width;
    const h = r.height || this._dspCanvas.height;
    const PAD = 34, MIN_DB = -15, MAX_DB = 15, FL = 20, FH = 20000;
    const BG = '#1c1c1c', GRID = '#333', CURVE = '#22ba00', TEXT = '#888', PT = '#fff';

    const fx = f => PAD + ((Math.log10(f) - Math.log10(FL)) / (Math.log10(FH) - Math.log10(FL))) * (w - 2*PAD);
    const vy = v => PAD + ((MAX_DB - v) / (MAX_DB - MIN_DB)) * (h - 2*PAD);

    ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);

    if (!this._dspBands.length) {
      ctx.fillStyle = TEXT; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No EQ entities found for prefix: ' + (this._activeId ? this._prefix(this._activeId) : '?'), w/2, h/2);
      return;
    }

    // Horizontal dB grid lines
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    [-12,-9,-6,-3,0,3,6,9,12].forEach(db => {
      if (db < MIN_DB || db > MAX_DB) return;
      const y = vy(db);
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(w - PAD, y); ctx.stroke();
      ctx.fillStyle = TEXT; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText((db > 0 ? '+' : '') + db, PAD - 4, y + 3);
    });

    // Vertical dotted lines at each band
    ctx.setLineDash([2,3]);
    this._dspBands.forEach(b => {
      ctx.beginPath(); ctx.moveTo(fx(b.freq), PAD); ctx.lineTo(fx(b.freq), h - PAD); ctx.stroke();
    });
    ctx.setLineDash([]);

    // Border
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.strokeRect(PAD, PAD, w - 2*PAD, h - 2*PAD);

    // Frequency labels
    ctx.fillStyle = TEXT; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    this._dspBands.forEach((b, i) => {
      if (i % 2 !== 0 && this._dspBands.length > 10) return;
      const lbl = b.freq >= 1000 ? (b.freq/1000) + 'k' : String(b.freq);
      ctx.fillText(lbl, fx(b.freq), h - PAD + 12);
    });

    // Bezier curve
    if (this._dspBands.length >= 2) {
      const pts = this._dspBands.map(b => ({ x: fx(b.freq), y: vy(b.value) }));
      ctx.strokeStyle = CURVE; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const mid = { x: (pts[i].x + pts[i+1].x)/2, y: (pts[i].y + pts[i+1].y)/2 };
        i === 0 ? ctx.lineTo(mid.x, mid.y) : ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
      }
      const l = pts.length - 1;
      ctx.quadraticCurveTo(pts[l-1].x, pts[l-1].y, pts[l].x, pts[l].y);
      ctx.stroke();
    }

    // Control points
    this._dspBands.forEach(b => {
      const x = fx(b.freq), y = vy(b.value);
      ctx.fillStyle = CURVE + '44'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 2*Math.PI); ctx.fill();
      ctx.fillStyle = PT;           ctx.beginPath(); ctx.arc(x, y, 4, 0, 2*Math.PI); ctx.fill();
      ctx.strokeStyle = CURVE; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  _dspPtrPos(e) {
    const r = this._dspCanvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  _dspNearest(x, y) {
    const PAD = 34, FL = 20, FH = 20000, MIN_DB = -15, MAX_DB = 15;
    const r = this._dspCanvas.getBoundingClientRect();
    const w = r.width, h = r.height;
    const fx = f => PAD + ((Math.log10(f) - Math.log10(FL)) / (Math.log10(FH) - Math.log10(FL))) * (w - 2*PAD);
    const vy = v => PAD + ((MAX_DB - v) / (MAX_DB - MIN_DB)) * (h - 2*PAD);
    let best = -1, bestD = 28;
    this._dspBands.forEach((b, i) => {
      const d = Math.hypot(x - fx(b.freq), y - vy(b.value));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  _dspSetY(idx, y) {
    const PAD = 34, MIN_DB = -15, MAX_DB = 15;
    const h = this._dspCanvas.getBoundingClientRect().height;
    const val = Math.round(Math.max(MIN_DB, Math.min(MAX_DB,
      MAX_DB - ((y - PAD) / (h - 2*PAD)) * (MAX_DB - MIN_DB))) * 2) / 2;
    this._dspBands[idx].value = val;
    this._dspDraw();
    this._hass?.callService('number', 'set_value', { entity_id: this._dspBands[idx].entityId, value: val });
  }

  _dspPtrDown(e) {
    e.preventDefault();
    if (!this._dspEditMode) return;
    const p = this._dspPtrPos(e);
    const idx = this._dspNearest(p.x, p.y);
    if (idx !== -1) { this._dspDragging = idx; this._dspSetY(idx, p.y); }
  }

  _dspPtrMove(e) {
    if (this._dspDragging === null) return;
    e.preventDefault();
    this._dspSetY(this._dspDragging, this._dspPtrPos(e).y);
  }

  _dspPtrUp() { this._dspDragging = null; }

  _updateVolSlider(color) {
    // Called after async color extraction to update slider gradient if color changed
    const slider = this.shadowRoot.querySelector('#volSlider');
    if (!slider) return;
    const v = slider.value;
    slider.style.background = 'linear-gradient(to right,rgba(255,255,255,0.85) ' + v + '%,rgba(255,255,255,0.28) ' + v + '%)';
  }
}

customElements.define('snapspot-mediaplayer-card', SnapspotMediaplayerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'snapspot-mediaplayer-card',
  name: 'Snapspot Media Player',
  description: 'Compact media player + source switcher for Snapspot ESPHome devices.',
  preview: false,
  documentationURL: 'https://github.com/farmed-switch/HA-Snapspot-Mediaplayer',
});
