class SnapspotMediaplayerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  // ── Config form (built-in HA editor) ────────────────────────────────────
  static getConfigForm() {
    return {
      schema: [
        {
          name: 'media_player',
          required: true,
          selector: { entity: { domain: ['media_player'] } },
        },
        {
          name: 'companion_player',
          required: false,
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
      ],
      computeLabel: (s) => ({
        media_player:     'Media Player (Snapcast or Spotify)',
        companion_player: 'Companion Player (optional – the other source on the same device)',
        show_dsp:         'Show DSP / EQ section',
        title:            'Card title (optional)',
      }[s.name] || s.name),
      computeHelper: (s) => {
        if (s.name === 'media_player')
          return 'Pick a Snapcast or Spotify player. Track, artist, album, artwork, position and duration are discovered automatically.';
        if (s.name === 'companion_player')
          return 'Pick the other media player for the same device to enable source switching.';
        return undefined;
      },
    };
  }

  static getStubConfig() {
    return { media_player: '', companion_player: '', show_dsp: true, title: '' };
  }

  // ── Entity helpers ───────────────────────────────────────────────────────

  // Strip domain + known source suffix → shared device prefix
  // e.g. media_player.foo_bar_snapcast  →  foo_bar
  _prefix() {
    const local = this._config.media_player.split('.')[1]; // strip "media_player."
    return local.replace(/_snapcast$/, '').replace(/_spotify$/, '');
  }

  // Source string derived from entity_id suffix
  _source() {
    const id = this._config.media_player;
    if (id.endsWith('_snapcast')) return 'snapcast';
    if (id.endsWith('_spotify'))  return 'spotify';
    return 'unknown';
  }

  // Build a full entity_id: domain + prefix + suffix
  _eid(domain, suffix) {
    return `${domain}.${this._prefix()}_${suffix}`;
  }

  // Safe state object lookup
  _state(entityId) {
    return (this._hass && entityId) ? (this._hass.states[entityId] || null) : null;
  }

  // ── Card lifecycle ───────────────────────────────────────────────────────
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return 5; }

  // ── Render shell (once) ──────────────────────────────────────────────────
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; }

        /* ── artwork + overlay ── */
        .art-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 1/1;
          background: #111;
          overflow: hidden;
        }
        .art-img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
          transition: opacity 0.4s;
        }
        .art-img[src=""] { opacity: 0; }
        .art-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 55%);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 16px;
          box-sizing: border-box;
        }
        .source-badge {
          position: absolute;
          top: 10px; right: 10px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 3px 8px;
          border-radius: 10px;
          background: var(--primary-color, #03a9f4);
          color: #fff;
          text-transform: uppercase;
        }
        .track-title {
          color: #fff;
          font-size: 18px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .track-sub {
          color: rgba(255,255,255,0.75);
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 2px;
        }
        .no-artwork-info {
          padding: 16px;
          background: var(--card-background-color, #1c1c1c);
        }
        .no-artwork-info .track-title { color: var(--primary-text-color); }
        .no-artwork-info .track-sub   { color: var(--secondary-text-color); }

        /* ── progress bar ── */
        .progress-wrap {
          padding: 10px 16px 0;
        }
        .progress-bg {
          width: 100%; height: 4px;
          background: var(--divider-color, #444);
          border-radius: 2px;
          cursor: pointer;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: var(--primary-color, #03a9f4);
          border-radius: 2px;
          width: 0%;
          transition: width 1s linear;
        }
        .progress-times {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--secondary-text-color, #888);
          margin-top: 3px;
          padding: 0 1px;
        }

        /* ── controls row ── */
        .controls {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px 12px;
        }
        .btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary-text-color);
          transition: background 0.2s;
        }
        .btn:hover { background: var(--secondary-background-color, #2a2a2a); }
        .btn svg { width: 28px; height: 28px; fill: currentColor; }
        .btn.play-pause svg { width: 36px; height: 36px; }
        .btn.small svg { width: 22px; height: 22px; }

        /* ── volume ── */
        .volume-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .volume-slider {
          flex: 1;
          -webkit-appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--divider-color, #444);
          outline: none;
          cursor: pointer;
        }
        .volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
        }

        /* ── idle / offline ── */
        .idle-wrap {
          padding: 24px 16px;
          text-align: center;
          color: var(--secondary-text-color, #888);
        }
        .idle-state {
          font-size: 14px;
          text-transform: capitalize;
          margin-top: 8px;
        }
      </style>
      <ha-card>
        <div id="root"></div>
      </ha-card>
    `;
    if (this._hass) this._update();
  }

  // ── Update (on every hass change) ───────────────────────────────────────
  _update() {
    if (!this._config || !this._hass) return;
    const root = this.shadowRoot && this.shadowRoot.querySelector('#root');
    if (!root) return;

    const mpId    = this._config.media_player;
    const mp      = this._state(mpId);
    const source  = this._source();
    const sfx     = source; // sensor suffix group name (snapcast / spotify)

    // Sensor entity IDs (discovered by prefix+source)
    const sensorTrack    = this._eid('sensor', `${sfx}_track`);
    const sensorArtist   = this._eid('sensor', `${sfx}_artist`);
    const sensorAlbum    = this._eid('sensor', `${sfx}_album`);
    const sensorArtUrl   = this._eid('sensor', `${sfx}_art_url`);
    const sensorDuration = this._eid('sensor', `${sfx}_duration`);
    const sensorPosition = this._eid('sensor', `${sfx}_position`);

    // Read values
    const track    = this._state(sensorTrack)?.state    || '';
    const artist   = this._state(sensorArtist)?.state   || '';
    const album    = this._state(sensorAlbum)?.state    || '';
    const artUrl   = this._state(sensorArtUrl)?.state   || '';
    const duration = parseFloat(this._state(sensorDuration)?.state) || 0;
    const position = parseFloat(this._state(sensorPosition)?.state) || 0;

    const mpState   = mp?.state || 'unavailable';
    const volLevel  = mp?.attributes?.volume_level ?? null;
    const isMuted   = mp?.attributes?.is_volume_muted ?? false;
    const isPlaying = mpState === 'playing';
    const isActive  = isPlaying || mpState === 'paused' || mpState === 'buffering';

    // Progress (0–100 %)
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

    // Format mm:ss
    const fmt = (s) => {
      const m = Math.floor(s / 60), sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    // ── Build HTML ──────────────────────────────────────────────────────────
    if (!mpId) {
      root.innerHTML = `<div class="idle-wrap">Select a media player entity in the card configuration.</div>`;
      return;
    }

    if (!mp) {
      root.innerHTML = `<div class="idle-wrap">Entity not found:<br><small>${mpId}</small></div>`;
      return;
    }

    const hasArt = artUrl && artUrl !== 'unavailable' && artUrl !== 'unknown';
    const infoHtml = `
      <div class="${hasArt ? 'art-overlay' : 'no-artwork-info'}">
        <div class="track-title">${track || '—'}</div>
        <div class="track-sub">${[artist, album].filter(Boolean).join(' · ') || mpState}</div>
      </div>
    `;

    const artHtml = hasArt
      ? `<div class="art-wrap">
           <img class="art-img" src="${artUrl}" alt="" onerror="this.style.opacity=0">
           <span class="source-badge">${source}</span>
           ${infoHtml}
         </div>`
      : `<div class="art-wrap" style="aspect-ratio:unset;height:auto;background:transparent">
           <span class="source-badge" style="position:relative;top:auto;right:auto;display:inline-flex;margin:16px 16px 0">
             ${source}
           </span>
           ${infoHtml}
         </div>`;

    // Play/pause SVG icons
    const playIcon  = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const pauseIcon = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    // Volume icon
    const volIcon = isMuted
      ? `<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18L19 19.27 20.27 18 5.27 3 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

    const progressHtml = isActive ? `
      <div class="progress-wrap">
        <div class="progress-bg" id="progressBg">
          <div class="progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="progress-times">
          <span>${fmt(position)}</span>
          <span>${duration > 0 ? fmt(duration) : ''}</span>
        </div>
      </div>` : '';

    const volVal = volLevel != null ? Math.round(volLevel * 100) : 50;

    root.innerHTML = `
      ${artHtml}
      ${progressHtml}
      <div class="controls">
        <button class="btn play-pause" id="btnPlayPause" title="${isPlaying ? 'Pause' : 'Play'}">
          ${isPlaying ? pauseIcon : playIcon}
        </button>
        <div class="volume-wrap">
          <button class="btn small" id="btnMute" title="${isMuted ? 'Unmute' : 'Mute'}">
            ${volIcon}
          </button>
          <input
            class="volume-slider" type="range" id="volSlider"
            min="0" max="100" value="${volVal}"
            style="background: linear-gradient(to right, var(--primary-color,#03a9f4) ${volVal}%, var(--divider-color,#444) ${volVal}%)"
          >
        </div>
      </div>
    `;

    // ── Wire up events ──────────────────────────────────────────────────────
    const id = this._config.media_player;

    root.querySelector('#btnPlayPause')?.addEventListener('click', () => {
      this._hass.callService('media_player', isPlaying ? 'media_pause' : 'media_play', { entity_id: id });
    });

    root.querySelector('#btnMute')?.addEventListener('click', () => {
      this._hass.callService('media_player', 'volume_mute', { entity_id: id, is_volume_muted: !isMuted });
    });

    const slider = root.querySelector('#volSlider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        e.target.style.background = `linear-gradient(to right, var(--primary-color,#03a9f4) ${val}%, var(--divider-color,#444) ${val}%)`;
      });
      slider.addEventListener('change', (e) => {
        const vol = parseInt(e.target.value, 10) / 100;
        this._hass.callService('media_player', 'volume_set', { entity_id: id, volume_level: vol });
      });
    }
  }
}

customElements.define('snapspot-mediaplayer-card', SnapspotMediaplayerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'snapspot-mediaplayer-card',
  name: 'Snapspot Media Player',
  description: 'Full media player + DSP control for Snapspot ESPHome devices.',
  preview: false,
  documentationURL: 'https://github.com/farmed-switch/HA-Snapspot-Mediaplayer',
});
