
function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.hidden = true;
  profileModalTarget = '';
  profileModalLoading = false;
  profileModalError = '';
}

async function mutateFriendship(mode, login) {
  const targetLogin = normalizeLogin(login);
  if (!targetLogin) return;
  const path = mode === 'remove' ? '/social/friends/remove' : '/social/friends/add';
  const response = await api(path, { login: targetLogin }, 'POST');
  if (!response.ok || !response.data || !response.data.ok) {
    profileModalError = response.data && response.data.error ? response.data.error : 'Не удалось обновить друзей';
    renderProfileModal(profileModalProfile);
    return;
  }
  await loadProfileModal(profileModalTarget || currentUserLogin || targetLogin);
}

async function mutateFriendRequest(mode, login) {
  const targetLogin = normalizeLogin(login);
  if (!targetLogin) return;
  const pathByMode = {
    add: '/social/friends/add',
    accept: '/social/friends/requests/accept',
    decline: '/social/friends/requests/decline',
    remove: '/social/friends/remove',
  };
  const path = pathByMode[mode] || pathByMode.add;
  const response = await api(path, { login: targetLogin }, 'POST');
  if (!response.ok || !response.data || !response.data.ok) {
    friendsModalError = response.data && response.data.error ? response.data.error : 'Не удалось обновить друзей';
    renderFriendsModal();
    return;
  }
  friendsModalError = '';
  await loadFriendsModal(true);
  await refreshFriendsBadge(true);
  if (profileModalProfile?.isSelf) {
    await loadProfileModal(profileModalTarget || currentUserLogin || targetLogin);
  }
}

function ensureFriendsModalBodyProfile() {
  return friendsModalProfile && friendsModalProfile.isSelf ? friendsModalProfile : null;
}

function renderFriendsModal() {
  const modal = document.getElementById('friends-modal');
  if (!modal) return;
  const body = document.getElementById('friends-modal-body');
  const title = document.getElementById('friends-title');
  const error = document.getElementById('friends-modal-error');
  const selfProfile = ensureFriendsModalBodyProfile();
  const requestsCount = Array.isArray(selfProfile?.requests) ? selfProfile.requests.length : 0;
  const friendsCount = Array.isArray(selfProfile?.friends) ? selfProfile.friends.length : 0;

  if (title) {
    title.textContent = friendsModalTab === 'requests' ? `Заявки (${requestsCount})` : `Список друзей (${friendsCount})`;
  }
  if (error) {
    error.textContent = friendsModalError || '';
  }
  document.querySelectorAll('[data-friends-tab]').forEach((btn) => {
    const active = (btn.getAttribute('data-friends-tab') || '') === friendsModalTab;
    btn.classList.toggle('is-active', active);
  });
  if (body) {
    if (friendsModalLoading) {
      body.innerHTML = '<div class="social-note">Загрузка списка друзей...</div>';
    } else if (!selfProfile) {
      body.innerHTML = '<div class="social-note">Сначала войди в игру, чтобы увидеть друзей и заявки.</div>';
    } else if (friendsModalTab === 'requests') {
      body.innerHTML = renderFriendsRequests(selfProfile);
    } else {
      body.innerHTML = renderFriendsList(selfProfile);
    }
  }
  bindFriendsModalEvents();
}

function bindFriendsModalEvents() {
  document.querySelectorAll('[data-friends-close]').forEach((btn) => {
    btn.onclick = closeFriendsModal;
  });
  document.querySelectorAll('[data-friends-tab]').forEach((btn) => {
    btn.onclick = () => {
      friendsModalTab = btn.getAttribute('data-friends-tab') || 'requests';
      renderFriendsModal();
    };
  });
  document.querySelectorAll('[data-friend-open]').forEach((btn) => {
    btn.onclick = () => {
      const login = btn.getAttribute('data-friend-open') || '';
      if (login) openProfileModal(login);
    };
  });
  document.querySelectorAll('[data-friend-preview]').forEach((btn) => {
    btn.onclick = () => {
      const login = btn.getAttribute('data-friend-preview') || '';
      if (login) openHamsterPreviewModal(login);
    };
  });
  document.querySelectorAll('[data-friend-accept]').forEach((btn) => {
    btn.onclick = async () => {
      const login = btn.getAttribute('data-friend-accept') || '';
      if (login) await mutateFriendRequest('accept', login);
    };
  });
  document.querySelectorAll('[data-friend-decline]').forEach((btn) => {
    btn.onclick = async () => {
      const login = btn.getAttribute('data-friend-decline') || '';
      if (login) await mutateFriendRequest('decline', login);
    };
  });
  document.querySelectorAll('[data-friend-remove]').forEach((btn) => {
    btn.onclick = async () => {
      const login = btn.getAttribute('data-friend-remove') || '';
      if (login) await mutateFriendRequest('remove', login);
    };
  });
}

window.humsterAddFriend = async (login) => {
  const normalized = normalizeLogin(login);
  if (!normalized) return;
  await mutateFriendRequest('add', normalized);
};

window.humsterAddFriendFromInput = async () => {
  const input = document.getElementById('friends-login-input');
  const login = input ? input.value.trim() : '';
  if (!login) return;
  await mutateFriendRequest('add', login);
  if (input) input.value = '';
};

async function loadFriendsModal(force = false) {
  ensureFriendsModal();
  const modal = document.getElementById('friends-modal');
  if (modal) modal.hidden = false;
  if (!isAuthenticated) {
    friendsModalProfile = null;
    friendsModalLoading = false;
    friendsModalError = 'Сначала войди в игру, чтобы пользоваться друзьями';
    renderFriendsModal();
    return;
  }
  const login = currentUserLogin || currentState?.player?.name || '';
  if (!login) {
    friendsModalProfile = null;
    friendsModalLoading = false;
    friendsModalError = 'Не удалось определить логин аккаунта';
    renderFriendsModal();
    return;
  }
  friendsModalLoading = true;
  if (force) friendsModalError = '';
  renderFriendsModal();
  try {
    const res = await fetch(apiUrl(`/social/profile?login=${encodeURIComponent(login)}`), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.profile) {
      friendsModalProfile = normalizeSocialProfile(data.profile);
      friendsModalError = '';
      friendsBadgeCount = Array.isArray(friendsModalProfile.requests) ? friendsModalProfile.requests.length : 0;
      friendsBadgeLastLoadedAt = Date.now();
      updateFriendsBadge();
      friendsModalLoading = false;
      renderFriendsModal();
      return;
    }
    friendsModalError = data && data.error ? data.error : 'Не удалось загрузить друзей';
    friendsModalProfile = null;
  } catch (error) {
    friendsModalError = 'Не удалось загрузить друзей';
    friendsModalProfile = null;
  }
  friendsModalLoading = false;
  friendsBadgeLastLoadedAt = Date.now();
  updateFriendsBadge();
  renderFriendsModal();
}

function updateFriendsBadge() {
  const badge = document.getElementById('friends-badge');
  if (!badge) return;
  const show = isAuthenticated && friendsBadgeCount > 0;
  badge.hidden = !show;
  badge.classList.toggle('is-active', show);
  badge.title = show ? `У вас ${friendsBadgeCount} заявк(и)` : '';
}

async function refreshFriendsBadge(force = false) {
  if (!isAuthenticated) {
    friendsBadgeCount = 0;
    friendsBadgeLastLoadedAt = Date.now();
    updateFriendsBadge();
    return;
  }
  const now = Date.now();
  if (!force && friendsBadgeLoading) return;
  if (!force && now - friendsBadgeLastLoadedAt < 10000) {
    updateFriendsBadge();
    return;
  }
  friendsBadgeLoading = true;
  try {
    const login = currentUserLogin || currentState?.player?.name || '';
    if (!login) {
      friendsBadgeCount = 0;
      return;
    }
    const res = await fetch(apiUrl(`/social/profile?login=${encodeURIComponent(login)}`), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.profile) {
      const profile = normalizeSocialProfile(data.profile);
      friendsBadgeCount = Array.isArray(profile.requests) ? profile.requests.length : 0;
      friendsModalProfile = profile;
    }
  } catch (_) {
    // keep previous badge value
  } finally {
    friendsBadgeLoading = false;
    friendsBadgeLastLoadedAt = Date.now();
    updateFriendsBadge();
    if (document.getElementById('friends-modal') && !document.getElementById('friends-modal').hidden) {
      renderFriendsModal();
    }
  }
}

function setupSocialPolling() {
  if (friendsBadgeInterval) return;
  const tick = () => {
    if (isAuthenticated) {
      void refreshFriendsBadge(true);
    }
  };
  friendsBadgeInterval = window.setInterval(tick, 15000);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick();
    }
  });
}

async function openFriendsModal() {
  ensureFriendsModal();
  const modal = document.getElementById('friends-modal');
  if (modal) modal.hidden = false;
  if (!friendsModalTab) friendsModalTab = 'requests';
  await loadFriendsModal(true);
}

function closeFriendsModal() {
  const modal = document.getElementById('friends-modal');
  if (modal) modal.hidden = true;
  friendsModalLoading = false;
  friendsModalError = '';
}

function ensureAchievementsModal() {
  if (document.getElementById('achievements-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="achievements-modal" class="achievements-modal" hidden>
      <div class="achievements-modal__backdrop" data-achievements-close></div>
      <div class="achievements-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="achievements-title">
        <div class="achievements-modal__head">
          <div>
            <div class="eyebrow">Достижения по игре</div>
            <h3 id="achievements-title">Битвы</h3>
          </div>
          <button type="button" class="ghost" data-achievements-close>Закрыть</button>
        </div>
        <div class="achievements-modal__tabs">
          <button type="button" class="achievements-modal__tab is-active" data-achievements-tab="battle">Битвы</button>
          <button type="button" class="achievements-modal__tab" data-achievements-tab="economy">Экономика</button>
        </div>
        <div id="achievements-modal-body" class="achievements-modal__body"></div>
      </div>
    </div>
  `);
}

function formatAchievementNumber(value) {
  return Number(value).toLocaleString('ru-RU');
}

function captureAchievementsAccordionState() {
  const body = document.getElementById('achievements-modal-body');
  if (!body) return;
  const next = {
    battle: achievementsAccordionState.battle !== false,
    economy: { ...(achievementsAccordionState.economy || {}) },
  };
  body.querySelectorAll('details[data-achievement-key]').forEach((details) => {
    const key = details.getAttribute('data-achievement-key') || '';
    if (!key) return;
    const scope = achievementsModalTab === 'battle' ? 'battle' : achievementsModalTab === 'economy' ? 'economy' : null;
    if (scope === 'battle' && key === 'battle') {
      next.battle = details.open;
    }
  });
  achievementsAccordionState = next;
}


function getLeaderboardPeriodCacheKey() {
  const day = typeof damageDayKey === 'function' ? damageDayKey() : '';
  const week = typeof damageWeekKey === 'function' ? damageWeekKey() : '';
  const month = typeof damageMonthKey === 'function' ? damageMonthKey() : '';
  return [day, week, month].join('|');
}

function renderLeaderboardSection(period, entries) {
  const rows = Array.isArray(entries) && entries.length
    ? entries.map((entry, index) => `
      <div class="leaderboard-row ${index === 0 ? 'is-first' : ''}">
        <span class="leaderboard-row__place">${entry.place || index + 1}</span>
        <button type="button" class="leaderboard-row__name" data-leaderboard-profile="${jsStringLiteral(entry.login || '')}">${entry.login || 'игрок'}</button>
        <strong class="leaderboard-row__damage">${formatAchievementNumber(entry.damage || 0)}</strong>
      </div>
    `).join('')
    : '<div class="social-note">Пока никто не попал в этот топ.</div>';
  return `
    <section class="leaderboard-card">
      <div class="profile-section__head">
        <strong>${period.label}</strong>
      </div>
      <div class="leaderboard-table">
        <div class="leaderboard-table__head">
          <span>#</span><span>Игрок</span><span>Урон</span>
        </div>
        <div class="leaderboard-table__body">
          ${rows}
        </div>
      </div>
    </section>
  `;
}

function renderLeaderboards() {
  if (leaderboardsLoading && !leaderboardsData) {
    return '<div class="social-note">Загрузка таблицы лидеров...</div>';
  }
  if (leaderboardsError) {
    return `<div class="social-note">${leaderboardsError}</div>`;
  }
  const data = leaderboardsData || {};
  return `
    <div class="leaderboard-grid">
      ${LEADERBOARD_PERIODS.map((period) => renderLeaderboardSection(period, data[period.key] || [])).join('')}
    </div>
  `;
}

function renderHomeLeaderboards() {
  return `
    <div class="leaderboard-home">
      <div class="profile-section__head">
        <strong>Таблица лидеров</strong>
      </div>
      ${renderLeaderboards()}
    </div>
  `;
}

async function loadLeaderboards(force = false) {
  const periodCacheKey = getLeaderboardPeriodCacheKey();
  const periodChanged = leaderboardsPeriodCacheKey !== periodCacheKey;
  if (periodChanged) {
    leaderboardsData = null;
    leaderboardsLoadedAt = 0;
  }
  if (leaderboardsLoading && !force && !periodChanged) return;
  if (!force && !periodChanged && leaderboardsData && Date.now() - leaderboardsLoadedAt < LEADERBOARD_REFRESH_MS) return;
  leaderboardsLoading = true;
  leaderboardsError = '';
  try {
    const response = await api('/leaderboards', {}, 'GET');
    if (response.ok && response.data && response.data.ok && response.data.leaderboards) {
      leaderboardsData = response.data.leaderboards;
      leaderboardsLoadedAt = Date.now();
      leaderboardsPeriodCacheKey = periodCacheKey;
    } else {
      leaderboardsError = response.data && response.data.error ? response.data.error : 'Не удалось загрузить таблицу лидеров';
    }
  } catch (_) {
    leaderboardsError = 'Не удалось загрузить таблицу лидеров';
  } finally {
    leaderboardsLoading = false;
    const modal = document.getElementById('achievements-modal');
    if (modal && !modal.hidden && achievementsModalTab === 'leaders') {
      renderAchievementsModal();
    }
    const home = document.getElementById('leaderboard-home-body');
    if (home) {
      home.innerHTML = renderHomeLeaderboards();
      bindLeaderboardEvents();
    }
  }
}

async function loadSocialSnapshot(force = false) {
  if (!isAuthenticated) {
    socialSnapshotProfile = null;
    socialSnapshotError = '';
    socialSnapshotLoadedAt = 0;
    return;
  }
  const login = normalizeLogin(currentUserLogin || currentState?.player?.name || '');
  if (!login) return;
  if (!force && socialSnapshotProfile && Date.now() - socialSnapshotLoadedAt < SOCIAL_SNAPSHOT_REFRESH_MS) return;
  if (socialSnapshotLoading) return;
  socialSnapshotLoading = true;
  socialSnapshotError = '';
  try {
    const res = await fetch(apiUrl(`/social/profile?login=${encodeURIComponent(login)}`), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.profile) {
      socialSnapshotProfile = normalizeSocialProfile(data.profile);
      if (socialSnapshotProfile && socialSnapshotProfile.isSelf) {
        friendsModalProfile = socialSnapshotProfile;
        friendsBadgeCount = Array.isArray(socialSnapshotProfile.requests) ? socialSnapshotProfile.requests.length : friendsBadgeCount;
        updateFriendsBadge();
      }
      socialSnapshotLoadedAt = Date.now();
    } else {
      socialSnapshotError = data && data.error ? data.error : 'Не удалось загрузить профиль';
    }
  } catch (_) {
    socialSnapshotError = 'Не удалось загрузить профиль';
  } finally {
    socialSnapshotLoading = false;
  }
}

function setupHomePolling() {
  if (pollingIntervalsInitialized) return;
  pollingIntervalsInitialized = true;
  window.setInterval(() => {
    void loadLeaderboards(true);
    if (isAuthenticated) {
      void loadSocialSnapshot(true);
    }
  }, LEADERBOARD_REFRESH_MS);
  window.addEventListener('focus', () => {
    void loadLeaderboards(true);
    if (isAuthenticated) {
      void loadSocialSnapshot(true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void loadLeaderboards(true);
      if (isAuthenticated) {
        void loadSocialSnapshot(true);
      }
    }
  });
}


function bindLeaderboardEvents() {
  document.querySelectorAll('[data-leaderboard-profile]').forEach((btn) => {
    btn.onclick = () => {
      const login = normalizeLogin(btn.getAttribute('data-leaderboard-profile') || '');
      if (login) openProfileModal(login);
    };
  });
}

function renderBattleAchievements() {
  const best = Math.max(0, Number(currentState?.bossBattleDamageBest) || 0);
  const current = Math.max(0, Number(currentState?.bossBattleDamageCurrent) || 0);
  const rows = BATTLE_DAMAGE_ACHIEVEMENTS.map((threshold) => {
    const unlocked = best >= threshold;
    const progress = Math.min(threshold, best);
    const percent = Math.max(0, Math.min(100, (progress / threshold) * 100));
    return `
      <div class="achievement-step ${unlocked ? 'is-done' : ''}">
        <div class="achievement-step__head">
          <strong>Нанесите ${formatAchievementNumber(threshold)} урона за одну битву</strong>
          <span>${unlocked ? 'Выполнено' : `${formatAchievementNumber(Math.max(0, threshold - best))} осталось`}</span>
        </div>
        <div class="achievement-step__bar"><div style="width: ${percent}%"></div></div>
        <div class="achievement-step__state">${unlocked ? `Лучший результат: ${formatAchievementNumber(best)}` : `Текущий лучший результат: ${formatAchievementNumber(best)}`}</div>
      </div>
    `;
  }).join('');

  const speedTargets = [
    { bossId: 'rat', label: 'Крыса', threshold: 3600 },
    { bossId: 'lizard', label: 'Ящерица', threshold: 3600 },
    { bossId: 'sand_lizard', label: 'Песчаная ящерица', threshold: 3600 },
  ];
  const speedRows = speedTargets.map((target) => {
    const boss = Array.isArray(currentState?.bosses) ? currentState.bosses.find((item) => item.id === target.bossId) : null;
    const bestClear = Math.max(0, Number(boss?.bestClearSeconds) || 0);
    const unlocked = bestClear > 0 && bestClear <= target.threshold;
    const progress = unlocked ? target.threshold : Math.min(target.threshold, bestClear || 0);
    const percent = Math.max(0, Math.min(100, (progress / target.threshold) * 100));
    return `
      <div class="achievement-step ${unlocked ? 'is-done' : ''}">
        <div class="achievement-step__head">
          <strong>Победите ${target.label} за 1 час</strong>
          <span>${unlocked ? `Выполнено • ${formatCountdown(bestClear * 1000)}` : (bestClear > 0 ? `Лучший результат: ${formatCountdown(bestClear * 1000)}` : 'Пока не выполнено')}</span>
        </div>
        <div class="achievement-step__bar"><div style="width: ${percent}%"></div></div>
        <div class="achievement-step__state">${unlocked ? 'Награда открыта' : `Нужно уложиться в ${formatCountdown(target.threshold * 1000)}`}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="achievement-summary">
      <div class="profile-card">
        <span>Лучший урон за одну битву</span>
        <strong>${formatAchievementNumber(best)}</strong>
      </div>
      <div class="profile-card">
        <span>Текущий урон в бою</span>
        <strong>${formatAchievementNumber(current)}</strong>
      </div>
    </div>
    <details class="achievement-accordion" data-achievement-key="battle" ${achievementsAccordionState.battle === false ? "" : "open"}>
      <summary>
        <div>
          <strong>Битвы</strong>
          <span>Нажми, чтобы свернуть или раскрыть список достижений</span>
        </div>
        <span class="achievement-accordion__hint">${BATTLE_DAMAGE_ACHIEVEMENTS.length} целей</span>
      </summary>
      <div class="achievement-accordion__content">
        ${rows}
      </div>
    </details>
    <section class="achievement-speed">
      <div class="profile-section__head">
        <strong>Скорость прохождения боссов</strong>
        <span>Победи каждого босса за 1 час</span>
      </div>
      <div class="achievement-speed__list">
        ${speedRows}
      </div>
    </section>
  `;
}

function renderEconomyAchievements() {
  const totals = currentState?.economyTotals || {};
  const resourceCards = ECONOMY_ACHIEVEMENTS.map((resource) => {
    const total = Math.max(0, Number(totals?.[resource.key]) || 0);
    return `
      <div class="profile-card">
        <span>${resource.label}</span>
        <strong>${formatAchievementNumber(total)}</strong>
      </div>
    `;
  }).join('');

  const sections = ECONOMY_ACHIEVEMENTS.map((resource) => {
    const total = Math.max(0, Number(totals?.[resource.key]) || 0);
    const isOpen = Object.prototype.hasOwnProperty.call(achievementsAccordionState.economy || {}, resource.key)
      ? Boolean(achievementsAccordionState.economy[resource.key])
      : resource.key === 'seeds';
    const rows = ECONOMY_ACHIEVEMENT_THRESHOLDS.map((threshold) => {
      const unlocked = total >= threshold;
      const percent = Math.max(0, Math.min(100, (Math.min(threshold, total) / threshold) * 100));
      return `
        <div class="achievement-step ${unlocked ? 'is-done' : ''}">
          <div class="achievement-step__head">
            <strong>Накопите ${formatAchievementNumber(threshold)} ${resource.form}</strong>
            <span>${unlocked ? 'Выполнено' : `${formatAchievementNumber(Math.max(0, threshold - total))} осталось`}</span>
          </div>
          <div class="achievement-step__bar"><div style="width: ${percent}%"></div></div>
          <div class="achievement-step__state">${unlocked ? `Всего накоплено: ${formatAchievementNumber(total)}` : `Сейчас накоплено: ${formatAchievementNumber(total)}`}</div>
        </div>
      `;
    }).join('');
    return `
      <section class="achievement-panel ${isOpen ? 'is-open' : ''}" data-achievement-key="${resource.key}">
        <button type="button" class="achievement-panel__summary" data-economy-toggle="${resource.key}" aria-expanded="${isOpen}">
          <div>
            <strong>${resource.label}</strong>
            <span>${formatAchievementNumber(total)} накоплено</span>
          </div>
          <span class="achievement-accordion__hint">${ECONOMY_ACHIEVEMENT_THRESHOLDS.length} целей</span>
        </button>
        <div class="achievement-panel__content" ${isOpen ? '' : 'hidden'}>
          ${rows}
        </div>
      </section>
    `;
  }).join('');

  return `
    <div class="achievement-summary">
      ${resourceCards}
    </div>
    ${sections}
  `;
}

function bindAchievementsModalEvents() {
  document.querySelectorAll('[data-achievements-close]').forEach((btn) => {
    btn.onclick = closeAchievementsModal;
  });
  document.querySelectorAll('[data-achievements-tab]').forEach((btn) => {
    btn.onclick = () => {
      achievementsModalTab = btn.getAttribute('data-achievements-tab') || 'battle';
      renderAchievementsModal();
    };
  });
  document.querySelectorAll('[data-leaderboard-profile]').forEach((btn) => {
    btn.onclick = () => {
      const login = normalizeLogin(btn.getAttribute('data-leaderboard-profile') || '');
      if (login) openProfileModal(login);
    };
  });
  document.querySelectorAll('details[data-achievement-key]').forEach((details) => {
    details.ontoggle = () => {
      captureAchievementsAccordionState();
    };
  });
  document.querySelectorAll('[data-economy-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.getAttribute('data-economy-toggle') || '';
      if (!key) return;
      const next = { ...(achievementsAccordionState.economy || {}) };
      const current = Object.prototype.hasOwnProperty.call(next, key) ? Boolean(next[key]) : key === 'seeds';
      next[key] = !current;
      achievementsAccordionState = {
        ...achievementsAccordionState,
        economy: next,
      };
      renderAchievementsModal();
    };
  });
}

function renderAchievementsModal() {
  const modal = document.getElementById('achievements-modal');
  if (!modal) return;
  const body = document.getElementById('achievements-modal-body');
  const title = document.getElementById('achievements-title');
  if (body) {
    captureAchievementsAccordionState();
  }
  const titles = { battle: 'Битвы', economy: 'Экономика' };
  if (title) {
    title.textContent = titles[achievementsModalTab] || 'Достижения';
  }
  const tabs = document.querySelectorAll('[data-achievements-tab]');
  tabs.forEach((tab) => {
    const active = (tab.getAttribute('data-achievements-tab') || '') === achievementsModalTab;
    tab.classList.toggle('is-active', active);
  });
  if (body) {
    if (achievementsModalTab === 'battle') {
      body.innerHTML = renderBattleAchievements();
    } else if (achievementsModalTab === 'economy') {
      body.innerHTML = renderEconomyAchievements();
    } else {
      body.innerHTML = '<div class="social-note">Раздел в разработке.</div>';
    }
  }
  bindAchievementsModalEvents();
}

function openAchievementsModal() {
  ensureAchievementsModal();
  const modal = document.getElementById('achievements-modal');
  if (modal) modal.hidden = false;
  renderAchievementsModal();
}

function closeAchievementsModal() {
  const modal = document.getElementById('achievements-modal');
  if (modal) modal.hidden = true;
}