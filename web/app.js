const $ = (sel) => document.querySelector(sel);

const CURRENCY_LABELS = { seeds: 'Семечки', wheat: 'Пшеница', carrot: 'Морковь' };
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) ? window.APP_CONFIG.apiBaseUrl : '/api';
const SESSION_KEY = 'humster_session_id';

const CATALOG = {
  clothes: [
    { id: 'straw_cap', name: 'Соломенная кепка', slot: 'head', desc: '10 семечек · +1 защита' },
    { id: 'grain_cloak', name: 'Зерновой плащ', slot: 'body', desc: '8 пшеницы · +2 HP, +1 защита' },
    { id: 'carrot_boots', name: 'Морковные сапожки', slot: 'feet', desc: '12 моркови · +2 энергия' },
  ],
  wallpapers: [
    { id: 'wallpaper_day', name: 'Летнее поле', slot: 'wallpaper', desc: 'Бесплатно', img: '/assets/wallpapers/field_day.png' },
    { id: 'wallpaper_sunset', name: 'Закатное поле', slot: 'wallpaper', desc: '18 семечек', img: '/assets/wallpapers/field_sunset.png' },
    { id: 'wallpaper_night', name: 'Ночное поле', slot: 'wallpaper', desc: '12 пшеницы', img: '/assets/wallpapers/field_night.png' },
  ],
};

function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (sid) return sid;

  if (window.crypto?.randomUUID) {
    sid = window.crypto.randomUUID();
  } else {
    sid = `sid-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  }
  localStorage.setItem(SESSION_KEY, sid);
  return sid;
}

function apiUrl(path) {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

async function api(path, payload) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Session': getSessionId(),
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function loadState() {
  const res = await fetch(apiUrl('/state'), {
    headers: { 'X-Game-Session': getSessionId() },
  });
  const data = await res.json();
  render(data.state);
}

function pct(current, max) {
  return max ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
}

function render(state) {
  const p = state.player;

  $('#player-name').textContent = `${p.name} — уровень ${p.level}`;
  $('#player-name-input').value = p.name;
  $('#location').textContent = state.location;
  $('#boss-status').textContent = state.boss.defeated ? 'Крыса: побеждена' : `Крыса: ${state.boss.hp}/${state.boss.maxHp}`;

  $('#hp-bar').style.width = `${pct(p.hp, p.maxHp)}%`;
  $('#energy-bar').style.width = `${pct(p.energy, p.maxEnergy)}%`;
  $('#hp-text').textContent = `${p.hp}/${p.maxHp}`;
  $('#energy-text').textContent = `${p.energy}/${p.maxEnergy}`;

  const stats = [
    ['Урон', p.attack],
    ['Защита', p.defense],
    ['Опыт', `${p.xp}/${p.level * 10}`],
  ];
  $('#stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');

  $('#currency-list').innerHTML = Object.entries(p.currency || {})
    .map(([k, v]) => `<div class="currency"><span>${CURRENCY_LABELS[k] || k}</span><strong>${v}</strong></div>`)
    .join('');

  renderShop('#clothes-shop', CATALOG.clothes, p);
  renderShop('#wallpaper-shop', CATALOG.wallpapers, p);

  $('#inventory').innerHTML = `
    <div class="inv-item">
      <div><strong>Экипировка</strong><small>${renderEquipped(p.equipped)}</small></div>
    </div>
    <div class="inv-item">
      <div><strong>Инвентарь</strong><small>${renderOwned(p.inventory)}</small></div>
    </div>
  `;

  $('#boss-card').innerHTML = `
    <div class="boss-box">
      <strong>${state.boss.name}</strong>
      <p>${state.boss.defeated ? 'Побеждена' : `HP: ${state.boss.hp}/${state.boss.maxHp}`}</p>
      <p>Награда: ${Object.entries(state.boss.reward || {}).map(([k, v]) => `${v} ${CURRENCY_LABELS[k] || k}`).join(', ')}</p>
    </div>
  `;

  $('#log').innerHTML = (state.log || []).map(line => `<div class="log-line">${line}</div>`).join('') || '<div class="log-line">Пока тихо.</div>';

  updateScene(state);

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      await api('/action', { action: btn.dataset.action });
      await loadState();
    };
  });

  document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      await api('/action', { action: 'buy_item', itemId: btn.dataset.buy });
      await loadState();
    };
  });

  document.querySelectorAll('[data-equip]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      await api('/action', { action: 'equip_item', itemId: btn.dataset.equip });
      await loadState();
    };
  });
}

function renderShop(selector, items, player) {
  const node = $(selector);
  node.innerHTML = items.map(item => {
    const equipped = isEquipped(player, item);
    const owned = !!player.inventory?.[item.id];
    return `
      <div class="shop-item">
        <div>
          <strong>${item.name}${equipped ? ' • надето' : ''}${owned && !equipped ? ' • куплено' : ''}</strong>
          <small>${item.desc}</small>
        </div>
        <div class="split">
          <button class="small" data-buy="${item.id}" ${owned ? 'disabled' : ''}>Купить</button>
          <button class="small secondary" data-equip="${item.id}" ${!owned || equipped ? 'disabled' : ''}>Надеть</button>
        </div>
      </div>
    `;
  }).join('');
}

function isEquipped(player, item) {
  if (!player?.equipped) return false;
  if (item.slot === 'wallpaper') return player.wallpaper === item.id || player.equipped.wallpaper === item.id;
  return player.equipped[item.slot] === item.id;
}

function updateScene(state) {
  const scene = $('#scene');
  const p = state.player;
  const wallpaperId = p.wallpaper || p.equipped?.wallpaper || 'wallpaper_day';
  const wallpaper = CATALOG.wallpapers.find(w => w.id === wallpaperId) || CATALOG.wallpapers[0];
  scene.style.backgroundImage = `url("${wallpaper.img}")`;
  $('#scene-meta').textContent = wallpaper.name;

  const head = p.equipped?.head;
  const body = p.equipped?.body;
  const feet = p.equipped?.feet;

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

function renderOwned(inv = {}) {
  const keys = Object.keys(inv);
  return keys.length ? keys.join(', ') : 'Пока пусто';
}

function renderEquipped(eq = {}) {
  const parts = Object.entries(eq)
    .filter(([k]) => k !== 'wallpaper')
    .map(([k, v]) => `${k}: ${v}`);
  const wallpaper = eq.wallpaper ? `wallpaper: ${eq.wallpaper}` : '';
  const all = wallpaper ? [...parts, wallpaper] : parts;
  return all.length ? all.join(' · ') : 'Пока ничего не надето';
}

$('#btn-new').onclick = async () => {
  await api('/action', { action: 'new_run' });
  await loadState();
};

$('#btn-save-name').onclick = async () => {
  const name = $('#player-name-input').value.trim();
  if (!name) return;
  await api('/name', { name });
  await loadState();
};

$('#player-name-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') $('#btn-save-name').click();
});

loadState();