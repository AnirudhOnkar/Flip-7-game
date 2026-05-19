/* ===========================
   Flip 7 — script.js
   =========================== */

/* ===========================
   State
   =========================== */

let state = {
  players: [],
  deck: [],
  round: 1,
  currentPlayerIndex: 0,
  pendingDuplicate: null,
  _flipThreeCards: [],
  _flipThreeTargetIndex: null,
  _freezeDrawerIndex: null,
  // Chained action card state (when action cards land inside a Flip Three)
  _chainedRemainingCards: [],
  _chainedOriginalTargetIdx: null,
  _chainedIsChained: false,
  _chainedFlipThreeCards: [],
  _chainedFlipThreeTargetIdx: null,
  _chainedParentTargetIdx: null,
  _chainedParentRemainingCards: null,
  _pendingSelfFreezeIdx: null,
};

/* ===========================
   Setup screen
   =========================== */

let playerCount = 2;

function changePlayerCount(delta) {
  playerCount = Math.min(6, Math.max(2, playerCount + delta));
  document.getElementById('player-count-display').textContent = playerCount;
  document.getElementById('btn-minus').disabled = playerCount <= 2;
  document.getElementById('btn-plus').disabled  = playerCount >= 6;
  renderNameInputs();
}

function renderNameInputs() {
  const section = document.getElementById('player-names-section');
  const label = document.createElement('label');
  label.className = 'setup-label';
  label.textContent = 'Player names';

  const wrap = document.createElement('div');
  wrap.className = 'name-inputs';

  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement('div');
    row.className = 'name-input-row';

    const lbl = document.createElement('span');
    lbl.className = 'name-input-label';
    lbl.textContent = `P${i + 1}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.placeholder = `Player ${i + 1}`;
    input.id = `name-input-${i}`;
    input.maxLength = 16;

    row.appendChild(lbl);
    row.appendChild(input);
    wrap.appendChild(row);
  }

  section.innerHTML = '';
  section.appendChild(label);
  section.appendChild(wrap);
}

function startGame() {
  const names = [];
  for (let i = 0; i < playerCount; i++) {
    const val = document.getElementById(`name-input-${i}`).value.trim();
    names.push(val || `Player ${i + 1}`);
  }

  state.players = names.map(name => ({
    name,
    totalScore: 0,
    hand: [],
    roundScore: 0,
    status: 'active', // active | stayed | busted | frozen | flip7
    hasSecondChance: false,
  }));

  state.round = 1;
  state.deck = buildDeck();

  showScreen('screen-game');
  startRound();
}

/* ===========================
   Deck
   =========================== */

function buildDeck() {
  const cards = [];

  for (let n = 0; n <= 12; n++) {
    const count = n === 0 ? 1 : n;
    for (let i = 0; i < count; i++) {
      cards.push({ type: 'number', value: n });
    }
  }

  [2, 4, 6, 8, 10].forEach(v => cards.push({ type: 'modifier', value: v }));
  cards.push({ type: 'x2' });

  for (let i = 0; i < 3; i++) {
    cards.push({ type: 'freeze' });
    cards.push({ type: 'flipthree' });
    cards.push({ type: 'secondchance' });
  }

  return shuffle(cards);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCard() {
  return state.deck.pop() || null;
}

/* ===========================
   Round start
   =========================== */

function startRound() {
  document.getElementById('round-num').textContent = state.round;
  clearLog();

  state.players.forEach(p => {
    p.hand = [];
    p.roundScore = 0;
    p.status = 'active';
    p.hasSecondChance = false;
  });

  state.currentPlayerIndex = 0;
  state._pendingSelfFreezeIdx = null;
  state._chainedRemainingCards = [];
  state._chainedOriginalTargetIdx = null;
  renderScoreboard();
  updateDeckCount();
  advanceToNextActivePlayer();
}

/* ===========================
   Turn management
   =========================== */

function advanceToNextActivePlayer() {
  const start = state.currentPlayerIndex;
  let found = false;

  for (let i = 0; i < state.players.length; i++) {
    const idx = (start + i) % state.players.length;
    if (state.players[idx].status === 'active') {
      state.currentPlayerIndex = idx;
      found = true;
      break;
    }
  }

  if (!found) {
    endRound();
    return;
  }

  renderCurrentPlayer();
}

function renderCurrentPlayer() {
  const p = state.players[state.currentPlayerIndex];
  document.getElementById('active-player-name').textContent = p.name;
  document.getElementById('active-player-status').textContent = 'Your turn';
  renderHand(p);
  renderScoreboard();
  hideMessage();
  enableButtons();
}

/* ===========================
   Player actions
   =========================== */

function playerHit() {
  disableButtons();
  const card = drawCard();
  if (!card) { endRound(); return; }
  updateDeckCount();
  const p = state.players[state.currentPlayerIndex];
  processCard(p, card);
}

function playerStay() {
  disableButtons();
  const p = state.players[state.currentPlayerIndex];
  p.status = 'stayed';
  p.roundScore = calcScore(p);
  logEntry(p.name, null, 'stay');
  showMessage(`${p.name} stayed with ${p.roundScore} pts`, 'stayed');
  renderScoreboard();

  setTimeout(() => {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    advanceToNextActivePlayer();
  }, 900);
}

/* ===========================
   Card processing
   =========================== */

function processCard(p, card) {

  if (card.type === 'number') {
    const alreadyHas = p.hand.some(c => c.type === 'number' && c.value === card.value);
    if (alreadyHas) {
      logEntry(p.name, card, 'duplicate');
      if (p.hasSecondChance) {
        state.pendingDuplicate = card;
        showSecondChanceOverlay(card);
      } else {
        bustPlayer(p);
      }
    } else {
      p.hand.push(card);
      logEntry(p.name, card, 'draw');
      renderHand(p);
      updateHandScore(p);
      const numCount = p.hand.filter(c => c.type === 'number').length;
      if (numCount === 7) { handleFlip7(p); return; }
      nextTurnAfterDelay();
    }

  } else if (card.type === 'modifier' || card.type === 'x2') {
    p.hand.push(card);
    logEntry(p.name, card, 'draw');
    renderHand(p);
    updateHandScore(p);
    nextTurnAfterDelay();

  } else if (card.type === 'secondchance') {
    p.hand.push(card);
    p.hasSecondChance = true;
    logEntry(p.name, card, 'draw');
    renderHand(p);
    updateHandScore(p);
    nextTurnAfterDelay();

  } else if (card.type === 'freeze') {
    // Don't add freeze card to hand yet — we need target first
    logEntry(p.name, card, 'freeze-drawn');
    showFreezeTargetPicker();

  } else if (card.type === 'flipthree') {
    // Don't add flipthree card to hand yet — we need target first
    logEntry(p.name, card, 'flipthree-drawn');
    showFlipThreeTargetPicker();
  }
}

function applyCardToPlayer(p, card, log = true) {
  if (card.type === 'secondchance') p.hasSecondChance = true;
  p.hand.push(card);
  if (log) logEntry(p.name, card, 'draw');
}

function nextTurnAfterDelay() {
  setTimeout(() => {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    advanceToNextActivePlayer();
  }, 600);
}

/* ===========================
   Busting
   =========================== */

function bustPlayer(p) {
  p.status = 'busted';
  p.roundScore = 0;
  p.hand = [];
  logEntry(p.name, null, 'bust');
  showMessage(`${p.name} busted! 0 points.`, 'bust');
  renderHand(p);
  renderScoreboard();

  setTimeout(() => {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    advanceToNextActivePlayer();
  }, 1200);
}

/* ===========================
   Flip 7
   =========================== */

function handleFlip7(p) {
  p.status = 'flip7';
  p.roundScore = calcScore(p, true);
  logEntry(p.name, null, 'flip7');
  showMessage(`🎉 ${p.name} hit Flip 7! +15 bonus. Round over!`, 'flip7');

  state.players.forEach(other => {
    if (other !== p && other.status === 'active') {
      other.status = 'stayed';
      other.roundScore = calcScore(other, false);
    }
  });

  renderScoreboard();
  setTimeout(endRound, 2000);
}

/* ===========================
   FREEZE — target picker
   =========================== */

function showFreezeTargetPicker() {
  const drawer = state.players[state.currentPlayerIndex];
  const activePlayers = state.players.filter(p => p.status === 'active');

  // Only one active player (the drawer) — force self-freeze
  if (activePlayers.length === 1) {
    applyFreeze(state.currentPlayerIndex);
    return;
  }

  const list = document.getElementById('freeze-target-list');
  list.innerHTML = '';

  state.players.forEach((p, idx) => {
    if (p.status !== 'active') return;

    const btn = document.createElement('button');
    btn.className = 'target-btn' + (idx === state.currentPlayerIndex ? ' target-btn-self' : '');
    btn.innerHTML = `
      <span class="target-btn-name">${p.name}</span>
      <span class="target-btn-hint">${idx === state.currentPlayerIndex ? 'yourself' : ''}</span>
    `;
    btn.onclick = () => {
      hideOverlay('overlay-freeze-target');
      applyFreeze(idx);
    };
    list.appendChild(btn);
  });

  state._freezeDrawerIndex = state.currentPlayerIndex;
  showOverlay('overlay-freeze-target');
}

function applyFreeze(targetIdx) {
  const drawer = state.players[state.currentPlayerIndex];
  const target = state.players[targetIdx];

  // Add freeze card to drawer's hand (they drew it)
  drawer.hand.push({ type: 'freeze' });
  renderHand(drawer);

  target.status = 'frozen';
  target.roundScore = calcScore(target);

  logEntry(drawer.name, null, targetIdx === state.currentPlayerIndex
    ? 'freeze-self'
    : `freeze-target:${target.name}`
  );

  const body = targetIdx === state.currentPlayerIndex
    ? `${target.name} froze themselves. Score of ${target.roundScore} banked.`
    : `${drawer.name} froze ${target.name}. ${target.name}'s score of ${target.roundScore} is banked.`;

  document.getElementById('freeze-confirm-body').textContent = body;
  renderScoreboard();
  showOverlay('overlay-freeze-confirm');
}

function dismissFreezeConfirm() {
  hideOverlay('overlay-freeze-confirm');

  const drawer = state.players[state.currentPlayerIndex];

  // If the drawer froze themselves, move to next player
  // If they froze someone else, they continue their turn (hit or stay)
  if (drawer.status === 'frozen') {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    advanceToNextActivePlayer();
  } else {
    // Drawer is still active — their turn continues
    renderCurrentPlayer();
  }
}

/* ===========================
   FLIP THREE — target picker
   =========================== */

function showFlipThreeTargetPicker() {
  const drawer = state.players[state.currentPlayerIndex];
  const activePlayers = state.players.filter(p => p.status === 'active');

  // Only one active player — force self
  if (activePlayers.length === 1) {
    resolveFlipThreeTarget(state.currentPlayerIndex);
    return;
  }

  const list = document.getElementById('flipthree-target-list');
  list.innerHTML = '';

  state.players.forEach((p, idx) => {
    if (p.status !== 'active') return;

    const btn = document.createElement('button');
    btn.className = 'target-btn' + (idx === state.currentPlayerIndex ? ' target-btn-self' : '');
    btn.innerHTML = `
      <span class="target-btn-name">${p.name}</span>
      <span class="target-btn-hint">${idx === state.currentPlayerIndex ? 'yourself' : ''}</span>
    `;
    btn.onclick = () => {
      hideOverlay('overlay-flipthree-target');
      resolveFlipThreeTarget(idx);
    };
    list.appendChild(btn);
  });

  showOverlay('overlay-flipthree-target');
}

function resolveFlipThreeTarget(targetIdx) {
  const drawer  = state.players[state.currentPlayerIndex];
  const target  = state.players[targetIdx];

  // Add flipthree card to drawer's hand
  drawer.hand.push({ type: 'flipthree' });
  renderHand(drawer);

  state._flipThreeTargetIndex = targetIdx;

  logEntry(drawer.name, null, targetIdx === state.currentPlayerIndex
    ? 'flipthree-self'
    : `flipthree-target:${target.name}`
  );

  // Draw 3 cards for the target
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    const card = drawCard();
    if (card) drawn.push(card);
  }
  updateDeckCount();

  state._flipThreeCards = drawn;

  // Show the reveal overlay
  document.getElementById('flipthree-target-name').textContent = target.name;
  const container = document.getElementById('flipthree-cards');
  container.innerHTML = '';
  drawn.forEach(card => container.appendChild(buildCardEl(card)));

  showOverlay('overlay-flipthree-reveal');
}

function dismissFlipThree() {
  hideOverlay('overlay-flipthree-reveal');
  // Process the 3 drawn cards for the target, handling action cards interactively
  processFlipThreeCards(state._flipThreeTargetIndex, [...state._flipThreeCards], false);
}

/* ===========================
   Flip Three card-by-card processor
   isChained = true when this came from a chained Flip Three
   (so we know to resume chained flow afterwards)
   =========================== */

function processFlipThreeCards(targetIdx, cards, isChained) {
  const target = state.players[targetIdx];
  const drawer = state.players[state.currentPlayerIndex];

  // Apply all plain cards first; stop and branch on first action card
  while (cards.length > 0) {
    const card = cards.shift();

    if (card.type === 'flipthree') {
      // Target gets the card in hand, then chooses who to send the next Flip Three to
      target.hand.push({ type: 'flipthree' });
      logEntry(target.name, card, 'flipthree-drawn');
      renderHand(targetIdx === state.currentPlayerIndex ? drawer : target);
      // Save remaining cards to continue after chained resolution
      state._chainedRemainingCards = cards;
      state._chainedOriginalTargetIdx = targetIdx;
      state._chainedIsChained = isChained;
      showChainedFlipThreeTargetPicker(targetIdx);
      return; // wait for user input
    }

    if (card.type === 'freeze') {
      // Target gets the card in hand, then chooses who to freeze
      target.hand.push({ type: 'freeze' });
      logEntry(target.name, card, 'freeze-drawn');
      state._chainedRemainingCards = cards;
      state._chainedOriginalTargetIdx = targetIdx;
      state._chainedIsChained = isChained;
      showChainedFreezeTargetPicker(targetIdx);
      return; // wait for user input
    }

    // Number card
    if (card.type === 'number') {
      const alreadyHas = target.hand.some(c => c.type === 'number' && c.value === card.value);
      if (alreadyHas) {
        if (target.hasSecondChance) {
          target.hasSecondChance = false;
          target.hand = target.hand.filter(c => c.type !== 'secondchance');
          logEntry(target.name, card, 'secondchance-used');
          renderHand(target);
          continue;
        }
        // Bust
        target.status = 'busted';
        target.roundScore = 0;
        target.hand = [];
        logEntry(target.name, null, 'bust');
        showMessage(`${target.name} busted from Flip Three!`, 'bust');
        renderScoreboard();
        finishFlipThreeResolution(targetIdx, isChained);
        return;
      }
    }

    applyCardToPlayer(target, card, true);
  }

  // All cards processed without interruption
  const numCount = target.hand.filter(c => c.type === 'number').length;
  if (numCount >= 7) {
    handleFlip7(target);
    return;
  }

  renderHand(targetIdx === state.currentPlayerIndex ? target : drawer);
  updateHandScore(drawer);
  finishFlipThreeResolution(targetIdx, isChained);
}

function finishFlipThreeResolution(targetIdx, isChained) {
  // Apply any pending self-freeze (player chose to freeze themselves but had to finish cards first)
  if (state._pendingSelfFreezeIdx !== null && state._pendingSelfFreezeIdx !== undefined) {
    const freezeIdx = state._pendingSelfFreezeIdx;
    state._pendingSelfFreezeIdx = null;
    const p = state.players[freezeIdx];
    p.status     = 'frozen';
    p.roundScore = calcScore(p);
    showMessage(p.name + ' is now frozen with ' + p.roundScore + ' pts banked.', 'info');
    renderScoreboard();
  }

  if (isChained) {
    // Resume the parent chain's remaining cards
    const parentTargetIdx = state._chainedParentTargetIdx;
    const remainingCards  = state._chainedParentRemainingCards || [];
    state._chainedParentTargetIdx      = null;
    state._chainedParentRemainingCards = null;
    setTimeout(() => processFlipThreeCards(parentTargetIdx, remainingCards, false), 800);
  } else {
    const drawerTargetedSelf = targetIdx === state.currentPlayerIndex;
    setTimeout(() => {
      if (drawerTargetedSelf) {
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
        advanceToNextActivePlayer();
      } else {
        renderCurrentPlayer();
      }
    }, 800);
  }
}

/* ===========================
   Chained Flip Three
   =========================== */

function showChainedFlipThreeTargetPicker(chainedDrawerIdx) {
  const chainedDrawer = state.players[chainedDrawerIdx];
  document.getElementById('chained-ft-drawer-name').textContent = chainedDrawer.name;

  const activePlayers = state.players.filter(p => p.status === 'active');

  const list = document.getElementById('chained-flipthree-target-list');
  list.innerHTML = '';

  // If only one active player force self
  if (activePlayers.length === 1) {
    resolveChainedFlipThreeTarget(chainedDrawerIdx, chainedDrawerIdx);
    return;
  }

  state.players.forEach((p, idx) => {
    if (p.status !== 'active') return;
    const btn = document.createElement('button');
    btn.className = 'target-btn' + (idx === chainedDrawerIdx ? ' target-btn-self' : '');
    btn.innerHTML = `
      <span class="target-btn-name">${p.name}</span>
      <span class="target-btn-hint">${idx === chainedDrawerIdx ? 'yourself' : ''}</span>
    `;
    btn.onclick = () => {
      hideOverlay('overlay-chained-flipthree-target');
      resolveChainedFlipThreeTarget(chainedDrawerIdx, idx);
    };
    list.appendChild(btn);
  });

  showOverlay('overlay-chained-flipthree-target');
}

function resolveChainedFlipThreeTarget(chainedDrawerIdx, chainedTargetIdx) {
  const chainedDrawer = state.players[chainedDrawerIdx];
  const chainedTarget = state.players[chainedTargetIdx];

  logEntry(chainedDrawer.name, null,
    chainedTargetIdx === chainedDrawerIdx
      ? 'flipthree-self'
      : `flipthree-target:${chainedTarget.name}`
  );

  // Draw 3 new cards for the chained target
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    const card = drawCard();
    if (card) drawn.push(card);
  }
  updateDeckCount();

  // Save context so we can resume the parent chain after this resolves
  state._chainedParentTargetIdx      = state._chainedOriginalTargetIdx;
  state._chainedParentRemainingCards = state._chainedRemainingCards;
  // Now set up this chained flip three
  state._chainedRemainingCards       = [];
  state._chainedOriginalTargetIdx    = chainedTargetIdx;

  document.getElementById('chained-flipthree-target-name').textContent = chainedTarget.name;
  const container = document.getElementById('chained-flipthree-cards');
  container.innerHTML = '';
  drawn.forEach(card => container.appendChild(buildCardEl(card)));

  // Store drawn cards on state for use by dismissChainedFlipThree
  state._chainedFlipThreeCards = drawn;
  state._chainedFlipThreeTargetIdx = chainedTargetIdx;

  showOverlay('overlay-chained-flipthree-reveal');
}

function dismissChainedFlipThree() {
  hideOverlay('overlay-chained-flipthree-reveal');
  processFlipThreeCards(state._chainedFlipThreeTargetIdx, [...state._chainedFlipThreeCards], true);
}

/* ===========================
   Chained Freeze (from within Flip Three)

   Rules:
   - If the Flip Three target draws a Freeze card they choose: freeze someone else OR freeze themselves.
   - Freeze someone else → that player is frozen immediately, remaining cards continue normally.
   - Freeze themselves (or no other active players exist) → they must receive ALL remaining
     cards from the Flip Three first, THEN they get frozen at the end.
   =========================== */

function showChainedFreezeTargetPicker(chainedDrawerIdx) {
  const chainedDrawer  = state.players[chainedDrawerIdx];
  const otherActives   = state.players.filter((p, idx) => p.status === 'active' && idx !== chainedDrawerIdx);

  document.getElementById('chained-freeze-drawer-name').textContent = chainedDrawer.name;

  // No other active players — must self-freeze after finishing cards
  if (otherActives.length === 0) {
    resolveChainedFreeze(chainedDrawerIdx, chainedDrawerIdx);
    return;
  }

  const list = document.getElementById('chained-freeze-target-list');
  list.innerHTML = '';

  // Self option first
  const selfBtn = document.createElement('button');
  selfBtn.className = 'target-btn target-btn-self';
  selfBtn.innerHTML = `
    <span class="target-btn-name">${chainedDrawer.name}</span>
    <span class="target-btn-hint">yourself — finish cards first, then freeze</span>
  `;
  selfBtn.onclick = () => {
    hideOverlay('overlay-chained-freeze-target');
    resolveChainedFreeze(chainedDrawerIdx, chainedDrawerIdx);
  };
  list.appendChild(selfBtn);

  // Other active players
  otherActives.forEach(p => {
    const idx = state.players.indexOf(p);
    const btn = document.createElement('button');
    btn.className = 'target-btn';
    btn.innerHTML = `
      <span class="target-btn-name">${p.name}</span>
      <span class="target-btn-hint">freeze immediately</span>
    `;
    btn.onclick = () => {
      hideOverlay('overlay-chained-freeze-target');
      resolveChainedFreeze(chainedDrawerIdx, idx);
    };
    list.appendChild(btn);
  });

  showOverlay('overlay-chained-freeze-target');
}

function resolveChainedFreeze(chainedDrawerIdx, chainedFreezeTargetIdx) {
  const chainedDrawer = state.players[chainedDrawerIdx];
  const freezeTarget  = state.players[chainedFreezeTargetIdx];
  const isSelfFreeze  = chainedFreezeTargetIdx === chainedDrawerIdx;

  if (isSelfFreeze) {
    // Must finish all remaining Flip Three cards first, freeze at the very end.
    // Flag the target so finishFlipThreeResolution freezes them after the last card.
    state._pendingSelfFreezeIdx = chainedDrawerIdx;
    logEntry(chainedDrawer.name, null, 'freeze-self');

    // Resume remaining cards — freeze will be applied in finishFlipThreeResolution
    const targetIdx      = state._chainedOriginalTargetIdx;
    const remainingCards = state._chainedRemainingCards || [];
    const isChained      = state._chainedIsChained || false;

    state._chainedRemainingCards    = [];
    state._chainedOriginalTargetIdx = null;
    state._chainedIsChained         = false;

    processFlipThreeCards(targetIdx, remainingCards, isChained);

  } else {
    // Freeze the other player immediately, then continue remaining cards
    freezeTarget.status     = 'frozen';
    freezeTarget.roundScore = calcScore(freezeTarget);

    logEntry(chainedDrawer.name, null, `freeze-target:${freezeTarget.name}`);

    const body = `${chainedDrawer.name} froze ${freezeTarget.name}. ${freezeTarget.name}'s score of ${freezeTarget.roundScore} is banked.`;
    document.getElementById('chained-freeze-confirm-body').textContent = body;
    renderScoreboard();
    showOverlay('overlay-chained-freeze-confirm');
  }
}

function dismissChainedFreezeConfirm() {
  hideOverlay('overlay-chained-freeze-confirm');

  // Resume remaining cards for the original Flip Three target
  const targetIdx      = state._chainedOriginalTargetIdx;
  const remainingCards = state._chainedRemainingCards || [];
  const isChained      = state._chainedIsChained || false;

  state._chainedRemainingCards    = [];
  state._chainedOriginalTargetIdx = null;
  state._chainedIsChained         = false;

  processFlipThreeCards(targetIdx, remainingCards, isChained);
}

/* ===========================
   Second Chance overlay
   =========================== */

function showSecondChanceOverlay(card) {
  document.getElementById('sc-dup-val').textContent = card.value;
  showOverlay('overlay-secondchance');
}

function useSecondChance() {
  hideOverlay('overlay-secondchance');
  const p = state.players[state.currentPlayerIndex];
  p.hasSecondChance = false;
  const scIdx = p.hand.findIndex(c => c.type === 'secondchance');
  if (scIdx !== -1) p.hand.splice(scIdx, 1);
  logEntry(p.name, null, 'secondchance-used');
  renderHand(p);
  updateHandScore(p);
  nextTurnAfterDelay();
}

function declineSecondChance() {
  hideOverlay('overlay-secondchance');
  const p = state.players[state.currentPlayerIndex];
  bustPlayer(p);
}

/* ===========================
   Scoring
   =========================== */

function calcScore(p, flip7Bonus = false) {
  if (p.status === 'busted') return 0;
  const numbers   = p.hand.filter(c => c.type === 'number');
  const modifiers = p.hand.filter(c => c.type === 'modifier');
  const hasX2     = p.hand.some(c => c.type === 'x2');
  let sum = numbers.reduce((acc, c) => acc + c.value, 0);
  if (hasX2) sum *= 2;
  sum += modifiers.reduce((acc, c) => acc + c.value, 0);
  if (flip7Bonus) sum += 15;
  return sum;
}

/* ===========================
   Round end
   =========================== */

function endRound() {
  state.players.forEach(p => {
    if (p.status === 'active') {
      p.status = 'stayed';
      p.roundScore = calcScore(p, false);
    }
  });

  state.players.forEach(p => { p.totalScore += p.roundScore; });

  const maxTotal = Math.max(...state.players.map(p => p.totalScore));
  const gameOver = maxTotal >= 200;

  showScreen('screen-roundend');
  document.getElementById('roundend-num').textContent = state.round;

  const scoresEl = document.getElementById('roundend-scores');
  scoresEl.innerHTML = '';
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'roundend-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'roundend-player-name';
    nameEl.textContent = p.name;

    const tagsEl = document.createElement('div');
    tagsEl.className = 'roundend-tags';
    if (p.status === 'busted')       tagsEl.innerHTML += `<span class="tag tag-bust">Bust</span>`;
    else if (p.status === 'frozen')  tagsEl.innerHTML += `<span class="tag tag-frozen">Frozen</span>`;
    else if (p.status === 'flip7')   tagsEl.innerHTML += `<span class="tag tag-flip7">Flip 7</span>`;
    else                             tagsEl.innerHTML += `<span class="tag tag-stayed">Stayed</span>`;

    const scoreEl = document.createElement('div');
    scoreEl.className = 'roundend-score' + (p.roundScore === 0 ? ' zero' : '');
    scoreEl.textContent = p.roundScore;

    row.appendChild(nameEl);
    row.appendChild(tagsEl);
    row.appendChild(scoreEl);
    scoresEl.appendChild(row);
  });

  const totalsEl = document.getElementById('roundend-totals');
  totalsEl.innerHTML = '<div class="roundend-totals-title">Running totals</div>';
  const sorted = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'total-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'total-name';
    nameEl.textContent = p.name;
    const valEl = document.createElement('div');
    valEl.className = 'total-val' + (p.totalScore === maxTotal ? ' leading' : '');
    valEl.textContent = p.totalScore;
    row.appendChild(nameEl);
    row.appendChild(valEl);
    totalsEl.appendChild(row);
  });

  document.getElementById('btn-next-round').textContent = gameOver ? 'See Final Results' : 'Next Round';
}

function nextRound() {
  const maxTotal = Math.max(...state.players.map(p => p.totalScore));
  if (maxTotal >= 200) { showGameOver(); return; }
  state.round++;
  state.deck = buildDeck();
  showScreen('screen-game');
  startRound();
}

/* ===========================
   Game over
   =========================== */

function showGameOver() {
  showScreen('screen-gameover');
  const sorted = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  const winner = sorted[0];
  document.getElementById('gameover-winner').textContent = `${winner.name} wins!`;
  const finalEl = document.getElementById('gameover-final');
  finalEl.innerHTML = '';
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'final-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'final-name' + (p === winner ? ' winner' : '');
    nameEl.textContent = p.name;
    const scoreEl = document.createElement('div');
    scoreEl.className = 'final-score' + (p === winner ? ' winner' : '');
    scoreEl.textContent = p.totalScore;
    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    finalEl.appendChild(row);
  });
}

function resetGame() {
  showScreen('screen-setup');
}

/* ===========================
   Rendering helpers
   =========================== */

function renderHand(p) {
  const el = document.getElementById('hand-cards');
  el.innerHTML = '';
  p.hand.forEach(card => el.appendChild(buildCardEl(card)));
}

function buildCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card new-card';

  if (card.type === 'number') {
    el.classList.add('card-number');
    el.textContent = card.value;
  } else if (card.type === 'modifier') {
    el.classList.add('card-modifier');
    el.textContent = `+${card.value}`;
  } else if (card.type === 'x2') {
    el.classList.add('card-x2');
    el.textContent = 'X2';
  } else if (card.type === 'freeze') {
    el.classList.add('card-action', 'card-freeze');
    el.textContent = 'FRZ';
  } else if (card.type === 'flipthree') {
    el.classList.add('card-action', 'card-flipthree');
    el.textContent = 'F3';
  } else if (card.type === 'secondchance') {
    el.classList.add('card-action', 'card-secondchance');
    el.textContent = 'SC';
  }

  return el;
}

function updateHandScore(p) {
  document.getElementById('hand-score').textContent = calcScore(p);
}

function renderScoreboard() {
  const el = document.getElementById('scoreboard');
  el.innerHTML = '';

  // Set CSS variable so columns divide evenly
  el.style.setProperty('--sb-player-count', state.players.length);

  state.players.forEach((p, i) => {
    const col = document.createElement('div');
    col.className = 'sb-col';
    col.dataset.playerIdx = i;

    // Status classes
    if (i === state.currentPlayerIndex && p.status === 'active') col.classList.add('sb-active');
    if (p.status === 'busted')  col.classList.add('sb-busted');
    if (p.status === 'stayed')  col.classList.add('sb-stayed');
    if (p.status === 'frozen')  col.classList.add('sb-frozen');
    if (p.status === 'flip7')   col.classList.add('sb-flip7');

    // Badge
    let badgeHtml = '';
    if (i === state.currentPlayerIndex && p.status === 'active') badgeHtml = `<span class="sb-badge sb-badge-turn">turn</span>`;
    else if (p.status === 'busted')  badgeHtml = `<span class="sb-badge sb-badge-bust">bust</span>`;
    else if (p.status === 'stayed')  badgeHtml = `<span class="sb-badge sb-badge-stayed">stayed</span>`;
    else if (p.status === 'frozen')  badgeHtml = `<span class="sb-badge sb-badge-frozen">frozen</span>`;
    else if (p.status === 'flip7')   badgeHtml = `<span class="sb-badge sb-badge-flip7">flip 7!</span>`;

    // Header: name + badge + scores
    col.innerHTML = `
      <div class="sb-col-header">
        <span class="sb-name">${p.name}</span>
        ${badgeHtml}
        <div class="sb-scores">
          <span class="sb-score-round">${
            p.status === 'busted'  ? '<span class="sb-round-bust">0</span>' :
            p.status === 'active'  ? '<span class="sb-round-live">' + calcScore(p) + '</span>' :
                                     '<span class="sb-round-banked">+' + p.roundScore + '</span>'
          }</span>
          <span class="sb-score-sep">/</span>
          <span class="sb-total-val">${p.totalScore}</span>
        </div>
      </div>
    `;

    // Cards area
    const cardsArea = document.createElement('div');
    cardsArea.className = 'sb-col-cards';

    if (p.status === 'busted') {
      cardsArea.innerHTML = `<span class="sb-no-cards">busted</span>`;
    } else if (p.hand.length === 0) {
      cardsArea.innerHTML = `<span class="sb-no-cards">no cards</span>`;
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'sb-cards';
      p.hand.forEach(card => wrap.appendChild(buildCardEl(card)));
      cardsArea.appendChild(wrap);
    }

    col.appendChild(cardsArea);
    el.appendChild(col);
  });
}

function updateDeckCount() {
  document.getElementById('deck-count').textContent = state.deck.length;
}

/* ===========================
   Message banner
   =========================== */

function showMessage(text, type) {
  const el = document.getElementById('message-banner');
  el.className = `message-banner ${type} show`;
  el.textContent = text;
}

function hideMessage() {
  const el = document.getElementById('message-banner');
  el.className = 'message-banner';
  el.textContent = '';
}

/* ===========================
   Buttons
   =========================== */

function enableButtons() {
  document.getElementById('btn-hit').disabled  = false;
  document.getElementById('btn-stay').disabled = false;
}

function disableButtons() {
  document.getElementById('btn-hit').disabled  = true;
  document.getElementById('btn-stay').disabled = true;
}

/* ===========================
   Overlays
   =========================== */

function showOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideOverlay(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ===========================
   Screen switching
   =========================== */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ===========================
   Log
   =========================== */

function logEntry(playerName, card, action) {
  const el = document.getElementById('log-entries');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  let html = `<span class="log-player">${playerName}</span> `;

  if (action === 'draw' && card) {
    if (card.type === 'number')       html += `drew <span class="log-card-num">${card.value}</span>`;
    else if (card.type === 'modifier') html += `drew <span class="log-card-mod">+${card.value}</span>`;
    else if (card.type === 'x2')      html += `drew <span class="log-card-mod">X2</span>`;
    else if (card.type === 'secondchance') html += `drew <span class="log-card-act">Second Chance</span>`;
    else if (card.type === 'flipthree')   html += `drew <span class="log-card-act">Flip Three</span>`;
    else if (card.type === 'freeze')      html += `drew <span class="log-card-act">Freeze</span>`;
  } else if (action === 'duplicate' && card) {
    html += `drew duplicate <span class="log-card-num">${card.value}</span>`;
  } else if (action === 'bust') {
    html += `<span class="log-bust">busted — 0 points</span>`;
  } else if (action === 'stay') {
    html += `<span class="log-stay">stayed</span>`;
  } else if (action === 'flip7') {
    html += `<span class="log-stay">hit Flip 7! +15 bonus</span>`;
  } else if (action === 'freeze-drawn') {
    html += `drew <span class="log-card-act">Freeze</span>`;
  } else if (action === 'freeze-self') {
    html += `<span class="log-card-act">froze themselves</span>`;
  } else if (action && action.startsWith('freeze-target:')) {
    const name = action.split(':')[1];
    html += `<span class="log-card-act">froze ${name}</span>`;
  } else if (action === 'flipthree-drawn') {
    html += `drew <span class="log-card-act">Flip Three</span>`;
  } else if (action === 'flipthree-self') {
    html += `<span class="log-card-act">used Flip Three on themselves</span>`;
  } else if (action && action.startsWith('flipthree-target:')) {
    const name = action.split(':')[1];
    html += `<span class="log-card-act">sent Flip Three to ${name}</span>`;
  } else if (action === 'secondchance-used') {
    html += `used <span class="log-card-act">Second Chance</span>`;
  }

  entry.innerHTML = html;
  el.prepend(entry);
}

function clearLog() {
  document.getElementById('log-entries').innerHTML = '';
}

/* ===========================
   Init
   =========================== */

document.addEventListener('DOMContentLoaded', () => {
  renderNameInputs();
  document.getElementById('btn-minus').disabled = true;
});