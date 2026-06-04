"use strict";

const $ = (sel) => document.querySelector(sel);

const CURRENCY_LABELS = {
  seeds: 'Семечки',
  wheat: 'Пшеница',
  carrot: 'Морковь',
};

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) ? window.APP_CONFIG.apiBaseUrl : '/api';
const SESSION_KEY = 'humster_session_id';

const ADVENTURE_DEFS = [
  { id: 'stage5', label: 'Бежать по полю', image: '/assets/adventure/stage5.png', x: 33.5, y: 24.8, energyCost: 1, requiredPasses: 4 },
  { id: 'stage4', label: 'Собирать пшеницу', image: '/assets/adventure/stage4.png', x: 67.6, y: 26.8, energyCost: 2, requiredPasses: 4 },
  { id: 'stage3', label: 'Собирать орешки для белочки', image: '/assets/adventure/stage3.png', x: 86.1, y: 53.3, energyCost: 3, requiredPasses: 5 },
  { id: 'stage2', label: 'Делать домик', image: '/assets/adventure/stage2.png', x: 52.3, y: 80.1, energyCost: 3, requiredPasses: 6 },
  { id: 'stage1', label: 'Строить мост через ручей', image: '/assets/adventure/stage1.png', x: 26.7, y: 50.8, energyCost: 4, requiredPasses: 6 },
];

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
  adventure: ADVENTURE_DEFS,
};

const telegram = window.Telegram?.WebApp || null;
if (telegram) {
  telegram.ready();
  telegram.expand();
  try {
    telegram.setHeaderColor?.('#5b3216');
    telegram.setBackgroundColor?.('#5b3216');
  } catch (_) {
    // no-op
  }
}

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
    energy: 40,
    maxEnergy: 40,
    attack: 2,
    defense: 0,
    currency: { seeds: 10, wheat: 3, carrot: 0 },
    inventory: { wallpaper_day: 1 },
    equipped: { wallpaper: 'wallpaper_day' },
    wallpaper: 'wallpaper_day',
  },
  location: 'Поле',
  bosses: [
    { id: 'rat', name: 'Крыса', hp: 200, maxHp: 200, attack: 4, reward: { seeds: 10, wheat: 1 }, xp: 10, defeated: false },
    { id: 'lizard', name: 'Ящерица', hp: 500, maxHp: 500, attack: 8, reward: { seeds: 30, wheat: 3 }, xp: 20, defeated: false },
    { id: 'sand_lizard', name: 'Песчаная ящерица', hp: 2000, maxHp: 2000, attack: 16, reward: { seeds: 100, wheat: 10, carrot: 1 }, xp: 50, defeated: false },
  ],
  activeBossId: '',
  adventure: ADVENTURE_DEFS.map((node) => ({
    id: node.id,
    name: node.label,
    energyCost: node.energyCost,
    requiredPasses: node.requiredPasses,
    progress: 0,
    completed: false,
  })),
  activeAdventureId: 'stage5',
  log: ['Добро пожаловать в поле хомяков.'],
  updatedAt: new Date().toISOString(),
  lastEnergyRegenAt: new Date().toISOString(),
};

let currentState = structuredClone(DEFAULT_STATE);
let view = 'main';
let pendingAdventureShakeId = null;

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

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function mergeAdventure(stateAdventure = []) {
  const map = new Map();
  for (const node of stateAdventure) {
    if (node && typeof node === 'object' && node.id) {
      map.set(node.id, node);
    }
  }
  return ADVENTURE_DEFS.map((def) => {
    const existing = map.get(def.id) || {};
    const progress = clampNumber(existing.progress ?? 0, 0, def.requiredPasses);
    return {
      id: def.id,
      name: def.label,
      energyCost: def.energyCost,
      requiredPasses: def.requiredPasses,
      progress,
      completed: Boolean(existing.completed) || progress >= def.requiredPasses,
    };

  });
}

function normalizeState(state) {
  const next = structuredClone(DEFAULT_STATE);
  if (!state || typeof state !== 'object') return next;

  next.player = { ...next.player, ...(state.player || {}) };
  next.player.currency = { ...DEFAULT_STATE.player.currency, ...((state.player && state.player.currency) || {}) };
  next.player.inventory = { ...DEFAULT_STATE.player.inventory, ...((state.player && state.player.inventory) || {}) };
  next.player.equipped = { ...DEFAULT_STATE.player.equipped, ...((state.player && state.player.equipped) || {}) };
  next.player.maxEnergy = 40;
  next.player.energy = clampNumber(next.player.energy, 0, 40);
  next.player.maxHp = clampNumber(next.player.maxHp, 1, 9999);
  next.player.hp = clampNumber(next.player.hp, 0, next.player.maxHp);

  next.bosses = Array.isArray(state.bosses)
    ? state.bosses.map((boss) => ({
        ...boss,
        reward: { ...(boss.reward || {}) },
      }))
    : structuredClone(DEFAULT_STATE.bosses);

  next.location = state.location || next.location;
  next.activeBossId = state.activeBossId || '';

  next.adventure = mergeAdventure(state.adventure);
  next.activeAdventureId = state.activeAdventureId && next.adventure.some((node) => node.id === state.activeAdventureId)
    ? state.activeAdventureId
    : next.adventure.find((node) => !node.completed)?.id || next.adventure[0]?.id || '';

  next.log = Array.isArray(state.log) ? [...state.log] : [...next.log];
  next.updatedAt = state.updatedAt || next.updatedAt;
  next.lastEnergyRegenAt = state.lastEnergyRegenAt || next.lastEnergyRegenAt;
  return next;
}


function toMillis(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function advanceLocalEnergy(state) {
  if (!state || !state.player) return state;
  const next = state;
  const now = Date.now();
  const maxEnergy = 40;
  const energy = clampNumber(next.player.energy, 0, maxEnergy);
  const lastTick = toMillis(next.lastEnergyRegenAt) || now;

  next.player.maxEnergy = maxEnergy;
  next.player.energy = energy;
  if (!next.lastEnergyRegenAt || !toMillis(next.lastEnergyRegenAt)) {
    next.lastEnergyRegenAt = new Date(now).toISOString();
    return next;
  }

  if (energy >= maxEnergy) {
    next.player.energy = maxEnergy;
    next.lastEnergyRegenAt = new Date(now).toISOString();
    return next;
  }

  const elapsed = now - lastTick;
  if (elapsed < 4 * 60 * 1000) return next;

  const gained = Math.floor(elapsed / (4 * 60 * 1000));
  if (gained <= 0) return next;

  const missing = maxEnergy - energy;
  const applied = Math.min(gained, missing);
  next.player.energy = Math.min(maxEnergy, energy + applied);
  next.lastEnergyRegenAt = new Date(lastTick + (applied * 4 * 60 * 1000)).toISOString();

  if (next.player.energy >= maxEnergy) {
    next.player.energy = maxEnergy;
    next.lastEnergyRegenAt = new Date(now).toISOString();
  }

  return next;
}

function getEnergyCountdown(state) {
  const player = state?.player || {};
  const energy = clampNumber(player.energy, 0, 40);
  const maxEnergy = 40;
  if (energy >= maxEnergy) return 'Энергия полная';
  const lastTick = toMillis(state?.lastEnergyRegenAt);
  if (!lastTick) return '+1 через 04:00';
  const elapsed = Date.now() - lastTick;
  const remaining = (4 * 60 * 1000) - (elapsed % (4 * 60 * 1000));
  return `+1 через ${formatCountdown(remaining)}`;
}

function bossById(state, id) {
  return (state?.bosses || []).find((boss) => boss.id === id) || null;
}

function getAdventureDef(id) {
  return ADVENTURE_DEFS.find((node) => node.id === id) || ADVENTURE_DEFS[0];
}

function getAdventureNode(state, id) {
  return (state?.adventure || []).find((node) => node.id === id) || null;
}

function selectedAdventureId(state) {
  if (state.activeAdventureId && getAdventureNode(state, state.activeAdventureId)) return state.activeAdventureId;
  return state.adventure.find((node) => !node.completed)?.id || state.adventure[0]?.id || '';
}

function activeAdventureNode(state) {
  return getAdventureNode(state, selectedAdventureId(state));
}

function firstIncompleteAdventureIndex(state) {
  return (state.adventure || []).findIndex((node) => !node.completed);
}

function isAdventureLocked(state, index) {
  const unlocked = firstIncompleteAdventureIndex(state);
  if (unlocked < 0) return false;
  return index > unlocked;
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


function renderResourceStrip(state) {
  const p = state.player;
  const currencies = p.currency || {};
  const chips = [
    { label: 'Хомяк', value: `${p.name} • ур. ${p.level}`, accent: true },
    { label: 'Семечки', value: `${currencies.seeds || 0}` },
    { label: 'Пшеница', value: `${currencies.wheat || 0}` },
    { label: 'Морковь', value: `${currencies.carrot || 0}` },
    { label: 'Энергия', value: `${p.energy || 0}/${p.maxEnergy || 40}`, sub: getEnergyCountdown(state) },
  ];

  $('#resource-strip').innerHTML = chips.map((chip) => `
    <div class="hud-chip ${chip.accent ? 'hud-chip--accent' : ''}">
      <span>${chip.label}</span>
      <strong>${chip.value}</strong>
      ${chip.sub ? `<small class="hud-chip__sub">${chip.sub}</small>` : ''}
    </div>
  `).join('');
}

function updateScene(state) {
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
      if (!boss || boss.defeated) return;
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
    case 'select_adventure': {
      const nodeId = payload.nodeId;
      if (nodeId && currentState.adventure.some((node) => node.id === nodeId)) {
        const idx = currentState.adventure.findIndex((node) => node.id === nodeId);
        if (!isAdventureLocked(currentState, idx)) {
          state.activeAdventureId = nodeId;
        }
      }
      return;
    }
    case 'adventure_step': {
      const nodeId = payload.nodeId || state.activeAdventureId;
      const idx = state.adventure.findIndex((node) => node.id === nodeId);
      if (idx < 0) return;
      if (isAdventureLocked(state, idx)) return;
      const node = state.adventure[idx];
      if (node.completed) return;
      if ((state.player.energy || 0) < node.energyCost) return;
      state.player.energy -= node.energyCost;
      node.progress += 1;
      if (node.progress >= node.requiredPasses) {
        node.completed = true;
        const next = state.adventure.find((item) => !item.completed);
        if (next) state.activeAdventureId = next.id;
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

function renderAdventureScreen() {
  const selectedId = selectedAdventureId(currentState);
  const selected = getAdventureNode(currentState, selectedId) || currentState.adventure[0];
  const def = getAdventureDef(selected?.id || ADVENTURE_DEFS[0].id);
  const isSelectedLocked = selected ? isAdventureLocked(currentState, currentState.adventure.findIndex((n) => n.id === selected.id)) : false;
  const progress = selected ? `${selected.progress}/${selected.requiredPasses}` : '0/0';
  const energy = currentState.player.energy || 0;
  const maxEnergy = currentState.player.maxEnergy || 40;
  const nodePct = selected && selected.requiredPasses > 0 ? Math.max(0, Math.min(100, (selected.progress / selected.requiredPasses) * 100)) : 0;

  $('#battle-screen').hidden = true;
  const body = $('#adventure-screen-body');
  if (!body) return;

  body.innerHTML = `
    <div class="adventure-layout">
      <div class="adventure-map-shell">
        <div class="adventure-map">
          <img class="adventure-map__bg" src="/assets/adventure/map.png" alt="Карта приключений">
          <div class="adventure-map__overlay"></div>

          ${currentState.adventure.map((node) => {
            const defNode = getAdventureDef(node.id);
            const idx = currentState.adventure.findIndex((n) => n.id === node.id);
            const locked = isAdventureLocked(currentState, idx);
            const classes = [
              'adventure-node',
              node.completed ? 'is-complete' : '',
              node.id === selectedId ? 'is-active' : '',
              locked ? 'is-locked' : '',
              pendingAdventureShakeId === node.id ? 'is-shaking' : '',
            ].filter(Boolean).join(' ');
            return `
              <button
                type="button"
                class="${classes}"
                data-adventure-node="${node.id}"
                aria-label="${node.name} • ${node.energyCost} энергии за проход • ${node.progress}/${node.requiredPasses}"
                style="left: ${defNode.x}%; top: ${defNode.y}%"
                ${locked ? 'disabled' : ''}
              >
                <span class="adventure-node__ring"></span>
                <img src="${defNode.image}" alt="${node.name}">
                <span class="adventure-node__badge">${node.id.replace('stage', '')}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <aside class="adventure-panel">
        <div class="adventure-panel__head">
          <div class="eyebrow">Карта приключений</div>
          <h3>${selected?.name || '—'}</h3>
          <p>${isSelectedLocked ? 'Следующая точка пока недоступна.' : 'Выбери точку и трать энергию на прохождение.'}</p>
        </div>

        <div class="adventure-stats">
          <div class="stat-box">
            <span>Стоимость за проход</span>
            <strong>${selected?.energyCost ?? 0} энергии</strong>
          </div>
          <div class="stat-box">
            <span>Пройдено</span>
            <strong>${progress}</strong>
          </div>
          <div class="stat-box">
            <span>Энергия</span>
            <strong>${energy}/${maxEnergy}</strong>
          </div>
        </div>

        <div class="meter-block">
          <div class="meter-label">
            <span>Прогресс точки</span>
            <strong>${nodePct.toFixed(0)}%</strong>
          </div>
          <div class="progress-bar"><div style="width: ${nodePct}%"></div></div>
        </div>


        <div class="adventure-actions">
          <button
            type="button"
            id="btn-adventure-step"
            class="primary"
            ${!selected || selected.completed || isSelectedLocked || energy < (selected?.energyCost || 0) ? 'disabled' : ''}
          >
            ${selected && !selected.completed ? `Пройти за ${selected.energyCost} энергии` : 'Точка пройдена'}
          </button>
          <button type="button" id="btn-adventure-back" class="ghost">Вернуться к сцене</button>
        </div>

        <div class="adventure-note">
          ${selected?.completed
            ? 'Эта точка уже пройдена. Можно посмотреть другие участки карты.'
            : `Нужно ${selected?.requiredPasses || 0} проходов по ${selected?.energyCost || 0} энергии. После завершения откроется следующая точка.`}
        </div>
      </aside>
    </div>
  `;

  document.querySelectorAll('[data-adventure-node]').forEach((btn) => {
    btn.onclick = async () => {
      const nodeId = btn.dataset.adventureNode;
      await syncAction('select_adventure', { nodeId });
      view = 'adventure';
      render();
    };
  });

  const step = $('#btn-adventure-step');
  if (step && selected && !selected.completed && !isSelectedLocked) {
    step.onclick = async () => {
      pendingAdventureShakeId = selected.id;
      step.disabled = true;
      await syncAction('adventure_step', { nodeId: selected.id });
      view = 'adventure';
      render();
    };
  }

  const back = $('#btn-adventure-back');
  if (back) {
    back.onclick = () => {
      view = 'main';
      render();
    };
  }

  if (pendingAdventureShakeId) {
    window.setTimeout(() => {
      const el = document.querySelector(`[data-adventure-node="${pendingAdventureShakeId}"]`);
      if (el) {
        el.classList.add('is-shaking');
        window.setTimeout(() => el.classList.remove('is-shaking'), 380);
      }
      pendingAdventureShakeId = null;
    }, 0);
  }
}

function render() {
  currentState = normalizeState(currentState);
  currentState = advanceLocalEnergy(currentState);
  $('#player-name-input').value = currentState.player.name || 'Хомяк';
  renderResourceStrip(currentState);
  updateScene(currentState);

  const main = $('#main-screen');
  const battle = $('#battle-screen');
  const adventure = $('#adventure-screen');

  if (view === 'battle') {
    main.hidden = true;
    adventure.hidden = true;
    battle.hidden = false;
    renderBattleScreen();
  } else if (view === 'adventure') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = false;
    renderAdventureScreen();
  } else {
    battle.hidden = true;
    adventure.hidden = true;
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
    view = 'adventure';
    render();
  };
}

function initBattleButtons() {
  $('#btn-battle-back').onclick = () => {
    view = 'main';
    render();
  };
}

function initAdventureButtons() {
  const topBack = $('#btn-adventure-back-top');
  if (topBack) {
    topBack.onclick = () => {
      view = 'main';
      render();
    };
  }
}

let uiTicker = null;

window.addEventListener('DOMContentLoaded', async () => {
  initTopButtons();
  initBattleButtons();
  initAdventureButtons();
  render();
  await loadState();

  if (!uiTicker) {
    uiTicker = window.setInterval(() => {
      currentState = advanceLocalEnergy(currentState);
      render();
    }, 1000);
  }
});