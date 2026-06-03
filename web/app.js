"use strict";

const $ = (sel) => document.querySelector(sel);

const CURRENCY_LABELS = { seeds: 'Семечки', wheat: 'Пшеница', carrot: 'Морковь' };
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) ? window.APP_CONFIG.apiBaseUrl : '/api';
const SESSION_KEY = 'humster_session_id';

const CATALOG = {
  wallpapers: [
    { id: 'wallpaper_day', name: 'Летнее поле', slot: 'wallpaper', img: '/assets/wallpapers/field_day.png' },
    { id: 'wallpaper_sunset', name: 'Закатное поле', slot: 'wallpaper', img: '/assets/wallpapers/field_sunset.png' },
    { id: 'wallpaper_night', name: 'Ночное поле', slot: 'wallpaper', img: '/assets/wallpapers/field_night.png' },
  ],
  bosses: [
    { id: 'rat', name: 'Крыса', img: '/assets/bosses/rat.png' },
    { id: 'lizard', name: 'Ящерица', img: '/assets/bosses/lizard.png' },
    { id: 'sand_lizard', name: 'Песчаная ящерица', img: '/assets/bosses/sand_lizard.png' },
  ],
};

const ATTACKS = [
  { id: 'belly_punch', label: 'Удар пузиком', damage: 5 },
  { id: 'scratch', label: 'Царапанье', damage: 20 },
  { id: 'rush', label: 'Удар с разбега', damage: 15 },
  { id: 'bite', label: 'Укус', damage: 30 },
];

const DEFAULT_STATE = {
  player: {
    name: 'Хомяк',
    level: 1,
    xp: 0,
    hp: 10,
    maxHp: 10,
    energy: 5,
    maxEnergy: 5,
    attack: 2,
    defense: 0,
    currency: { seeds: 10, wheat: 3, carrot: 0 },
    inventory: { wallpaper_day: 1 },
    equipped: { wallpaper: 'wallpaper_day' },
    wallpaper: 'wallpaper_day',
  },
  location: 'Домик',
  bosses: [
    { id: 'rat', name: 'Крыса', hp: 200, maxHp: 200, attack: 4, reward: { seeds: 10, wheat: 1 }, xp: 10, defeated: false },
    { id: 'lizard', name: 'Ящерица', hp: 500, maxHp: 500, attack: 8, reward: { seeds: 30, wheat: 3 }, xp: 20, defeated: false },
    { id: 'sand_lizard', name: 'Песчаная ящерица', hp: 2000, maxHp: 2000, attack: 16, reward: { seeds: 100, wheat: 10, carrot: 1 }, xp: 50, defeated: false },
  ],
  activeBossId: '',
  log: ['Добро пожаловать в поле хомяков.'],
  updatedAt: new Date().toISOString(),
};

let currentState = structuredClone(DEFAULT_STATE);
let view = 'main';

function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (sid) return sid;
  sid = window.crypto?.randomUUID ? window.crypto.randomUUID() : `sid-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  localStorage.setItem(SESSION_KEY, sid);
  return sid;
}

function apiUrl(path) {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

async function api(path, payload) {
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Game-Session': getSessionId(),
      },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (error) {
    return null;
  }
}

async function loadState() {
  try {
    const res = await fetch(apiUrl('/state'), {
      headers: { 'X-Game-Session': getSessionId() },
    });
    const data = await res.json();
    if (data && data.state) {
      currentState = normalizeState(data.state);
    }
  } catch (error) {
    // Keep local fallback.
  }
  render();
}

function normalizeState(state) {
  const next = structuredClone(DEFAULT_STATE);
  if (!state || typeof state !== 'object') return next;
  next.player = { ...next.player, ...(state.player || {}) };
  next.player.currency = { ...DEFAULT_STATE.player.currency, ...((state.player && state.player.currency) || {}) };
  next.player.inventory = { ...DEFAULT_STATE.player.inventory, ...((state.player && state.player.inventory) || {}) };
  next.player.equipped = { ...DEFAULT_STATE.player.equipped, ...((state.player && state.player.equipped) || {}) };
  next.bosses = Array.isArray(state.bosses) ? state.bosses.map((boss) => ({ ...boss, reward: { ...(boss.reward || {}) } })) : structuredClone(DEFAULT_STATE.bosses);
  next.location = state.location || next.location;
  next.activeBossId = state.activeBossId || '';
  next.log = Array.isArray(state.log) ? [...state.log] : [...next.log];
  next.updatedAt = state.updatedAt || next.updatedAt;
  return next;
}

function bossById(state, id) {
  return (state?.bosses || []).find((boss) => boss.id === id) || null;
}

function formatReward(reward = {}) {
  const parts = Object.entries(reward)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${v} ${CURRENCY_LABELS[k] || k}`);
  return parts.length ? parts.join(', ') : 'Награда отсутствует';
}

function wallpaperName(id) {
  return (CATALOG.wallpapers.find((w) => w.id === id) || CATALOG.wallpapers[0]).name;
}

function getWallpaperAsset(id) {
  return CATALOG.wallpapers.find((w) => w.id === id) || CATALOG.wallpapers[0];
}

function defeatedCount(state) {
  return `${(state?.bosses || []).filter((boss) => boss.defeated).length}/${(state?.bosses || []).length}`;
}

function renderResourceStrip(state) {
  const p = state.player;
  const currencies = p.currency || {};
  const chips = [
    { label: 'Хомяк', value: `${p.name} • ур. ${p.level}`, accent: true },
    { label: 'Семечки', value: `${currencies.seeds || 0}` },
    { label: 'Пшеница', value: `${currencies.wheat || 0}` },
    { label: 'Морковь', value: `${currencies.carrot || 0}` },
    { label: 'Энергия', value: `${p.energy || 0}/${p.maxEnergy || 0}` },
    { label: 'Боссы', value: defeatedCount(state) },
  ];

  $('#resource-strip').innerHTML = chips.map((chip) => `
    <div class="hud-chip ${chip.accent ? 'hud-chip--accent' : ''}">
      <span>${chip.label}</span>
      <strong>${chip.value}</strong>
    </div>
  `).join('');
}

function updateScene(state) {
  const scene = $('#scene');
  const wallpaperId = state.player.wallpaper || state.player.equipped?.wallpaper || 'wallpaper_day';
  const wallpaper = getWallpaperAsset(wallpaperId);

  $('#scene-wallpaper').style.backgroundImage = `url("${wallpaper.img}")`;
  $('#scene-meta').textContent = wallpaper.name;

  const head = state.player.equipped?.head;
  const body = state.player.equipped?.body;
  const feet = state.player.equipped?.feet;

  $('#hamster-outfit').innerHTML = `
    ${head === 'straw_cap' ? `
      <div class="outfit-head">
        <div class="cap"></div>
        <div class="cap-brim"></div>
      </div>
    ` : ''}
    ${body === 'grain_cloak' ? `
      <div class="outfit-body">
        <div class="cloak"></div>
        <div class="cloak-belt"></div>
      </div>
    ` : ''}
    ${feet === 'carrot_boots' ? `
      <div class="outfit-feet">
        <div class="boots"></div>
      </div>
    ` : ''}
  `;
}

function attackDamage(attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  return attack ? attack.damage : 0;
}

function attackLabel(attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  return attack ? attack.label : 'удар';
}

function applyLocalAction(action, payload = {}) {
  const state = currentState;
  const bossIndex = state.bosses.findIndex((boss) => boss.id === state.activeBossId);
  const boss = bossIndex >= 0 ? state.bosses[bossIndex] : null;

  switch (action) {
    case 'select_boss': {
      state.activeBossId = payload.bossId || '';
      return;
    }
    case 'attack_boss': {
      if (!boss) return;
      if (boss.defeated) return;

      const dmg = attackDamage(payload.attackType);
      boss.hp = Math.max(0, boss.hp - dmg);
      if (boss.hp === 0) {
        boss.defeated = true;
        for (const [cur, amt] of Object.entries(boss.reward || {})) {
          state.player.currency[cur] = (state.player.currency[cur] || 0) + amt;
        }
        state.player.xp += boss.xp || 0;
        recalcLevel(state);
      }
      return;
    }
    case 'new_run': {
      currentState = normalizeState(DEFAULT_STATE);
      return;
    }
    default:
      return;
  }
}

function recalcLevel(state) {
  while (state.player.xp >= state.player.level * 10) {
    const need = state.player.level * 10;
    state.player.xp -= need;
    state.player.level += 1;
    state.player.maxHp += 2;
    state.player.hp = state.player.maxHp;
    state.player.attack += 1;
    state.player.defense += 1;
    state.player.maxEnergy += 1;
    state.player.energy = state.player.maxEnergy;
  }
}

async function syncAction(action, payload = {}) {
  const response = await api('/action', { action, ...payload });
  if (response && response.ok && response.state) {
    currentState = normalizeState(response.state);
  } else {
    applyLocalAction(action, payload);
  }
  render();
}

function renderBossSelection() {
  $('#battle-screen-title').textContent = 'Выбор босса';
  $('#battle-screen-subtitle').textContent = 'Нажми на босса, чтобы начать бой.';
  const body = $('#battle-screen-body');
  body.innerHTML = `
    <div class="modal-note">Выбери босса, чтобы открыть бой. Награда выдаётся сразу после победы.</div>
    <div class="boss-grid">
      ${(currentState.bosses || []).map((boss) => {
        const cat = CATALOG.bosses.find((item) => item.id === boss.id) || boss;
        const rewardText = formatReward(boss.reward);
        const hpText = `${boss.maxHp || boss.hp} HP`;
        return `
          <article class="boss-card ${boss.defeated ? 'is-defeated' : ''}">
            <img class="boss-card__img" src="${cat.img}" alt="${boss.name}" />
            <div class="boss-card__body">
              <div class="boss-card__title">
                <strong>${boss.name}</strong>
                <span>${hpText}</span>
              </div>
              <div class="boss-card__reward">Награда: ${rewardText}</div>
              <button class="primary boss-select" data-boss="${boss.id}" type="button">
                ${boss.defeated ? 'Открыть ещё раз' : 'Выбрать и начать бой'}
              </button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('[data-boss]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await syncAction('select_boss', { bossId: btn.dataset.boss });
      view = 'battle';
      render();
    };
  });
}

function renderBattleScreen() {
  const activeBoss = bossById(currentState, currentState.activeBossId);
  if (!activeBoss) {
    renderBossSelection();
    return;
  }

  $('#battle-screen-title').textContent = `Бой: ${activeBoss.name}`;
  $('#battle-screen-subtitle').textContent = activeBoss.defeated
    ? 'Босс уже побеждён. Можно выбрать другого.'
    : 'Удары идут снизу панели. После каждого удара босс отвечает, если ещё жив.';

  const body = $('#battle-screen-body');
  const percent = activeBoss.maxHp ? Math.max(0, Math.min(100, (activeBoss.hp / activeBoss.maxHp) * 100)) : 0;
  const cat = CATALOG.bosses.find((item) => item.id === activeBoss.id) || activeBoss;

  body.innerHTML = `
    <div class="battle-top">
      <div class="battle-portrait">
        <img src="${cat.img}" alt="${activeBoss.name}" />
      </div>
      <div class="battle-info">
        <div class="battle-info__head">
          <strong>${activeBoss.name}</strong>
          <span>${activeBoss.defeated ? 'Побеждён' : `HP ${activeBoss.hp}/${activeBoss.maxHp}`}</span>
        </div>
        <div class="battle-bar"><div style="width: ${percent}%"></div></div>
        <div class="battle-reward">Награда: ${formatReward(activeBoss.reward)}</div>
        <div class="battle-note">${activeBoss.defeated ? 'Босс уже побеждён. Выбирай следующего.' : 'Выбирай удар снизу и добивай босса.'}</div>
        <div class="battle-controls">
          <button class="ghost" id="btn-boss-change" type="button">Выбрать другого</button>
        </div>
      </div>
    </div>

    <div class="attack-panel">
      ${(ATTACKS.map((attack) => `
        <button class="attack-btn" data-attack="${attack.id}" ${activeBoss.defeated ? 'disabled' : ''}>
          <span>${attack.label}</span>
          <strong>${attack.damage} урона</strong>
        </button>
      `)).join('')}
    </div>
  `;

  document.querySelectorAll('[data-attack]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await syncAction('attack_boss', { attackType: btn.dataset.attack });
      view = 'battle';
      render();
    };
  });

  const change = $('#btn-boss-change');
  if (change) {
    change.onclick = async () => {
      await syncAction('select_boss', { bossId: '' });
      view = 'battle';
      render();
    };
  }
}

function render() {
  currentState = normalizeState(currentState);
  $('#player-name-input').value = currentState.player.name || 'Хомяк';
  renderResourceStrip(currentState);
  updateScene(currentState);

  const main = $('#main-screen');
  const battle = $('#battle-screen');

  if (view === 'battle') {
    main.hidden = true;
    battle.hidden = false;
    renderBattleScreen();
  } else {
    battle.hidden = true;
    main.hidden = false;
  }
}

function initTopButtons() {
  $('#btn-save-name').onclick = async () => {
    const name = $('#player-name-input').value.trim();
    if (!name) return;
    const response = await api('/name', { name });
    if (response && response.ok && response.state) {
      currentState = normalizeState(response.state);
    } else {
      currentState.player.name = name;
    }
    render();
  };

  $('#btn-new').onclick = async () => {
    localStorage.removeItem(SESSION_KEY);
    currentState = normalizeState(DEFAULT_STATE);
    view = 'main';
    await syncAction('new_run', {});
    render();
  };

  $('#btn-battle-panel').onclick = () => {
    view = 'battle';
    render();
  };

  $('#btn-map-panel').onclick = () => {
    // Пока ничего не делает.
  };
}

function initBattleButtons() {
  $('#btn-battle-back').onclick = () => {
    view = 'main';
    render();
  };
}

window.addEventListener('DOMContentLoaded', async () => {
  initTopButtons();
  initBattleButtons();
  render();
  await loadState();
});