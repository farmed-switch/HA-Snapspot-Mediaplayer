class SnapspotMediaplayerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config   = null;
    this._hass     = null;
    this._activeId = null;
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
    this._config   = config;
    this._activeId = config.media_player || null;
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
        ha-card { overflow: hidden; }

        .card-body {
          display: flex;
          align-items: stretch;
          min-height: 130px;
        }
        .info-col {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 12px 10px 10px 16px;
        }
        .art-col {
          width: 120px;
          min-width: 120px;
          overflow: hidden;
          background: var(--secondary-background-color, #1e1e1e);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .art-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .art-placeholder { color: var(--disabled-text-color, #555); }
        .art-placeholder svg { width: 48px; height: 48px; fill: currentColor; display: block; }
        .source-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 5px;
        }
        .source-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 2px 7px;
          border-radius: 10px;
          background: var(--primary-color, #03a9f4);
          color: #fff;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .source-badge.spotify { background: #1db954; }
        .device-name {
          font-size: 11px;
          color: var(--secondary-text-color, #888);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .track-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.35;
        }
        .track-sub {
          font-size: 12px;
          color: var(--secondary-text-color, #888);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 1px;
        }
        .controls-row {
          display: flex;
          align-items: center;
          margin-top: 8px;
        }
        .btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary-text-color);
          flex-shrink: 0;
        }
        .btn:hover { background: var(--secondary-background-color, rgba(128,128,128,0.15)); }
        .btn svg { fill: currentColor; display: block; }
        .btn.play  svg { width: 30px; height: 30px; }
        .btn.small svg { width: 20px; height: 20px; }
        .vol-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: 4px;
        }
        .vol-slider {
          flex: 1;
          -webkit-appearance: none;
          height: 3px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
          min-width: 0;
        }
        .vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
        }
        .progress-wrap { margin-top: 5px; }
        .progress-bg {
          width: 100%; height: 3px;
          background: var(--divider-color, #444);
          border-radius: 2px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: var(--primary-color, #03a9f4);
          border-radius: 2px;
          transition: width 1s linear;
        }
        .progress-times {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--secondary-text-color, #888);
          margin-top: 2px;
        }
        .companion-bar {
          display: flex;
          border-top: 1px solid var(--divider-color, rgba(128,128,128,0.2));
        }
        .comp-btn {
          flex: 1;
          padding: 6px 0;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--secondary-text-color, #888);
          transition: color 0.15s, background 0.15s;
        }
        .comp-btn.active { color: var(--primary-color, #03a9f4); background: rgba(3,169,244,0.06); }
        .comp-btn.active.spotify { color: #1db954; background: rgba(29,185,84,0.06); }
        .comp-btn:hover:not(.active) { background: rgba(128,128,128,0.1); }
        .comp-divider { width: 1px; background: var(--divider-color, rgba(128,128,128,0.2)); align-self: stretch; }
        .idle-wrap {
          padding: 24px 16px;
          text-align: center;
          color: var(--secondary-text-color, #888);
          font-size: 13px;
        }
      </style>
      <ha-card>
        <div id="root"></div>
      </ha-card>
    `;
    if (this._hass) this._update();
  }

  _update() {
    if (!this._config || !this._hass) return;
    const root = this.shadowRoot && this.shadowRoot.querySelector('#root');
    if (!root) return;

    const activeId = this._activeId;

    if (!activeId) {
      root.innerHTML = '<div class="idle-wrap">Select a media player entity in the card configuration.</div>';
      return;
    }

    const mp = this._state(activeId);
    if (!mp) {
      root.innerHTML = '<div class="idle-wrap">Entity not found:<br><small>' + activeId + '</small></div>';
      return;
    }

    const source   = this._source(activeId);
    const track    = this._state(this._eid(activeId, 'sensor', source + '_track'))?.state    || '';
    const artist   = this._state(this._eid(activeId, 'sensor', source + '_artist'))?.state   || '';
    const album    = this._state(this._eid(activeId, 'sensor', source + '_album'))?.state    || '';
    const artUrl   = this._state(this._eid(activeId, 'sensor', source + '_art_url'))?.state  || '';
    const duration = parseFloat(this._state(this._eid(activeId, 'sensor', source + '_duration'))?.state) || 0;
    const position = parseFloat(this._state(this._eid(activeId, 'sensor', source + '_position'))?.state) || 0;

    const mpState   = mp.state || 'unavailable';
    const volLevel  = mp.attributes?.volume_level ?? null;
    const isMuted   = mp.attributes?.is_volume_muted ?? false;
    const isPlaying = mpState === 'playing';
    const isActive  = isPlaying || mpState === 'paused' || mpState === 'buffering';

    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

    const hasArt  = artUrl && artUrl !== 'unavailable' && artUrl !== 'unknown' && artUrl !== '';
    const volVal  = volLevel != null ? Math.round(volLevel * 100) : 50;
    const volGrad = 'linear-gradient(to right,var(--primary-color,#03a9f4) ' + volVal + '%,var(--divider-color,#444) ' + volVal + '%)';
    const deviceName = this._config.title || mp.attributes?.friendly_name || this._prefix(activeId);

    const PLAY  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    const PREV  = '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>';
    const NEXT  = '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
    const VOL   = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    const MUTE  = '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18L19 19.27 20.27 18 5.27 3 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
    const NOTE  = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>';

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
      '<div class="card-body">'
      + '<div class="info-col">'
      + '<div>'
      + '<div class="source-row"><span class="source-badge ' + source + '">' + source + '</span><span class="device-name">' + deviceName + '</span></div>'
      + '<div class="track-title">' + (track || (isActive ? '—' : mpState)) + '</div>'
      + '<div class="track-sub">' + [artist, album].filter(Boolean).join(' · ') + '</div>'
      + '</div>'
      + '<div>'
      + '<div class="controls-row">'
      + '<button class="btn small" id="btnPrev">' + PREV + '</button>'
      + '<button class="btn play" id="btnPlay">' + (isPlaying ? PAUSE : PLAY) + '</button>'
      + '<button class="btn small" id="btnNext">' + NEXT + '</button>'
      + '<div class="vol-wrap">'
      + '<button class="btn small" id="btnMute">' + (isMuted ? MUTE : VOL) + '</button>'
      + '<input class="vol-slider" type="range" id="volSlider" min="0" max="100" value="' + volVal + '" style="background:' + volGrad + '">'
      + '</div>'
      + '</div>'
      + progressHtml
      + '</div>'
      + '</div>'
      + '<div class="art-col">'
      + (hasArt ? '<img class="art-img" src="' + artUrl + '" alt="">' : '<div class="art-placeholder">' + NOTE + '</div>')
      + '</div>'
      + '</div>'
      + companionHtml;

    root.querySelector('#btnPlay')?.addEventListener('click', () =>
      this._hass.callService('media_player', isPlaying ? 'media_pause' : 'media_play', { entity_id: activeId }));
    root.querySelector('#btnPrev')?.addEventListener('click', () =>
      this._hass.callService('media_player', 'media_previous_track', { entity_id: activeId }));
    root.querySelector('#btnNext')?.addEventListener('click', () =>
      this._hass.callService('media_player', 'media_next_track', { entity_id: activeId }));
    root.querySelector('#btnMute')?.addEventListener('click', () =>
      this._hass.callService('media_player', 'volume_mute', { entity_id: activeId, is_volume_muted: !isMuted }));

    const slider = root.querySelector('#volSlider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const v = e.target.value;
        e.target.style.background = 'linear-gradient(to right,var(--primary-color,#03a9f4) ' + v + '%,var(--divider-color,#444) ' + v + '%)';
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
