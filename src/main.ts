import './styles.css';
import { LEVELS } from './data/levels';
import { CHIPS } from './sim/chips';
import { createSimState, evaluateCircuit, tickClock, validateCircuit } from './sim/engine';
import type { Bit, ChipKind, Circuit, Level, PlacedChip, SimState, ValidationResult, Wire } from './sim/types';
import { loadSave, writeSave } from './storage';
import { setMuted, sfx } from './ui/sfx';

const app = document.querySelector<HTMLDivElement>('#app')!;
const GRID = 20;

let save = loadSave();
setMuted(save.muted);

let level: Level = LEVELS.find(l => l.number === save.level) ?? LEVELS[0];
let circuit: Circuit = cloneCircuit(save.circuits[level.number] ?? { chips: [], wires: [] });
let boardInputs: Bit[] = level.inputs.map(() => 0);
let sim: SimState = evaluateCircuit(level, circuit, boardInputs);
let validation: ValidationResult | null = null;
let selectedChipId: string | null = null;
let armedPin: { node: string; pin: number; dir: 'out' | 'in' } | null = null;
let hintOpen = false;
let drawerOpen = false;
let helpOpen = false;
let successModal: ValidationResult | null = null;
let toast: { text: string; kind: 'info' | 'ok' | 'error' } | null = null;
let toastTimer: number | undefined;
let autoClockTimer: number | undefined;
let undoStack: Circuit[] = [];
let redoStack: Circuit[] = [];
let idCounter = 1;

function nextId(prefix: string): string {
  while (
    circuit.chips.some(c => c.id === `${prefix}${idCounter}`) ||
    circuit.wires.some(w => w.id === `${prefix}${idCounter}`)
  ) {
    idCounter++;
  }
  return `${prefix}${idCounter++}`;
}

function cloneCircuit(c: Circuit): Circuit {
  return {
    chips: c.chips.map(ch => ({ ...ch })),
    wires: c.wires.map(w => ({ ...w })),
  };
}

function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function showToast(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  toast = { text, kind };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = null;
    app.querySelector('.board-toast')?.remove();
  }, 3600);
}

function persist(): void {
  save.level = level.number;
  save.circuits[level.number] = cloneCircuit(circuit);
  writeSave(save);
}

function pushUndo(): void {
  undoStack.push(cloneCircuit(circuit));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function stopAutoClock(): void {
  if (autoClockTimer !== undefined) {
    clearInterval(autoClockTimer);
    autoClockTimer = undefined;
  }
}

function recompute(resetMemory = false): void {
  const mem = resetMemory ? {} : sim.memory;
  const ticks = resetMemory ? 0 : sim.ticks;
  sim = evaluateCircuit(level, circuit, boardInputs, mem, ticks);
}

function selectLevel(n: number): void {
  stopAutoClock();
  const next = LEVELS.find(l => l.number === n);
  if (!next) return;
  level = next;
  circuit = cloneCircuit(save.circuits[n] ?? { chips: [], wires: [] });
  boardInputs = level.inputs.map(() => 0);
  sim = evaluateCircuit(level, circuit, boardInputs);
  validation = null;
  selectedChipId = null;
  armedPin = null;
  hintOpen = false;
  drawerOpen = false;
  successModal = null;
  toast = null;
  undoStack = [];
  redoStack = [];
  persist();
  render();
}

function addChip(kind: ChipKind, x?: number, y?: number): void {
  pushUndo();
  const board = app.querySelector<HTMLElement>('.board');
  const bw = board?.clientWidth ?? 640;
  const bh = board?.clientHeight ?? 440;
  const count = circuit.chips.length;
  const col = Math.floor(count / 3) % 3;
  const row = count % 3;
  const px = x ?? Math.round((bw * 0.28 + col * 190) / GRID) * GRID;
  const py = y ?? Math.round((bh * 0.2 + row * 120) / GRID) * GRID;
  const clampedX = Math.max(140, Math.min(bw - 240, px));
  const clampedY = Math.max(40, Math.min(bh - 150, py));
  const chip: PlacedChip = { id: nextId('c'), kind, x: clampedX, y: clampedY, value: 0 };
  circuit.chips.push(chip);
  selectedChipId = chip.id;
  validation = null;
  sfx.snap();
  recompute();
  persist();
  render();
}

function removeChip(id: string): void {
  pushUndo();
  circuit.chips = circuit.chips.filter(c => c.id !== id);
  circuit.wires = circuit.wires.filter(w => w.fromNode !== id && w.toNode !== id);
  if (selectedChipId === id) selectedChipId = null;
  if (armedPin?.node === id) armedPin = null;
  validation = null;
  sfx.snip();
  recompute();
  persist();
  render();
}

function compatibleKinds(kind: ChipKind): ChipKind[] {
  const spec = CHIPS[kind];
  const same = level.available.filter(k => {
    const other = CHIPS[k];
    return other.inputs.length === spec.inputs.length && other.outputs.length === spec.outputs.length;
  });
  const idx = same.indexOf(kind);
  const rotated = idx >= 0 ? [...same.slice(idx + 1), ...same.slice(0, idx)] : same;
  return rotated.filter(k => k !== kind);
}

function swapChip(id: string, nextKind: ChipKind): void {
  const chip = circuit.chips.find(c => c.id === id);
  if (!chip || chip.kind === nextKind) return;
  const cur = CHIPS[chip.kind];
  const next = CHIPS[nextKind];
  if (cur.inputs.length !== next.inputs.length || cur.outputs.length !== next.outputs.length) return;
  pushUndo();
  chip.kind = nextKind;
  if (nextKind === 'SWITCH' && chip.value === undefined) chip.value = 0;
  validation = null;
  sfx.snap();
  recompute();
  persist();
  render();
}

function connectWire(fromNode: string, fromPin: number, toNode: string, toPin: number): void {
  if (fromNode === toNode && fromNode.startsWith('IN:')) return;
  if (fromNode === toNode && fromNode.startsWith('OUT:')) return;
  const exists = circuit.wires.some(
    w => w.fromNode === fromNode && w.fromPin === fromPin && w.toNode === toNode && w.toPin === toPin,
  );
  if (exists) {
    showToast('Those pins are already connected.');
    render();
    return;
  }
  pushUndo();
  circuit.wires.push({ id: nextId('w'), fromNode, fromPin, toNode, toPin });
  validation = null;
  sfx.wire();
  recompute();
  persist();
  render();
}

function removeWire(id: string): void {
  pushUndo();
  circuit.wires = circuit.wires.filter(w => w.id !== id);
  validation = null;
  sfx.snip();
  recompute();
  persist();
  render();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneCircuit(circuit));
  circuit = prev;
  selectedChipId = null;
  armedPin = null;
  validation = null;
  recompute();
  persist();
  render();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneCircuit(circuit));
  circuit = next;
  selectedChipId = null;
  armedPin = null;
  validation = null;
  recompute();
  persist();
  render();
}

function clearBoard(): void {
  if (!circuit.chips.length && !circuit.wires.length) return;
  pushUndo();
  circuit = { chips: [], wires: [] };
  selectedChipId = null;
  armedPin = null;
  validation = null;
  sfx.snip();
  recompute(true);
  persist();
  render();
}

function doClockTick(): void {
  sim = tickClock(level, circuit, boardInputs, sim);
  sfx.tick();
  render();
}

function toggleAutoClock(): void {
  if (autoClockTimer !== undefined) {
    stopAutoClock();
    render();
    return;
  }
  doClockTick();
  autoClockTimer = window.setInterval(doClockTick, 650);
  render();
}

function checkCircuit(): void {
  stopAutoClock();
  validation = validateCircuit(level, circuit);
  if (validation.passed) {
    if (!save.completed.includes(level.number)) save.completed.push(level.number);
    const prevBest = save.bestChips[level.number];
    save.bestChips[level.number] = Math.min(prevBest ?? Infinity, validation.chipCount);
    persist();
    successModal = validation;
    sfx.win();
    launchConfetti();
    render();
  } else {
    const failed = validation.rows.find(r => !r.passed);
    if (failed) {
      boardInputs = [...failed.inputs];
      recompute(true);
    }
    sfx.fail();
    showToast('Not quite yet — check the red test row in the table!', 'error');
    render();
  }
}

function launchConfetti(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.className = 'confetti';
  const colors = ['#47f0ff', '#5ce68a', '#ffd45d', '#ff6b6b', '#a87dff'];
  for (let i = 0; i < 110; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 140}px`);
    piece.style.setProperty('--spin', `${540 + Math.random() * 720}deg`);
    host.appendChild(piece);
  }
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 4200);
}

function seg7Char(chip: PlacedChip): string {
  const incoming = (pin: number): Bit => {
    for (const w of circuit.wires) {
      if (w.toNode === chip.id && w.toPin === pin && sim.wireValues[w.id] === 1) return 1;
    }
    return 0;
  };
  const val = incoming(0) * 8 + incoming(1) * 4 + incoming(2) * 2 + incoming(3);
  return val.toString(16).toUpperCase();
}

function lampLit(chip: PlacedChip): boolean {
  return circuit.wires.some(w => w.toNode === chip.id && w.toPin === 0 && sim.wireValues[w.id] === 1);
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(46, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function pinCoords(node: string, pin: number, dir: 'out' | 'in'): { x: number; y: number } | null {
  const board = app.querySelector<HTMLElement>('.board');
  const el = app.querySelector<HTMLElement>(
    `.pin[data-node="${node}"][data-pin="${pin}"][data-dir="${dir}"]`,
  );
  if (!board || !el) return null;
  const b = board.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
}

function renderWiresSvg(): void {
  const svg = app.querySelector<SVGSVGElement>('.wires');
  if (!svg) return;
  const parts: string[] = [];
  for (const w of circuit.wires) {
    const p1 = pinCoords(w.fromNode, w.fromPin, 'out');
    const p2 = pinCoords(w.toNode, w.toPin, 'in');
    if (!p1 || !p2) continue;
    const d = wirePath(p1.x, p1.y, p2.x, p2.y);
    const on = sim.wireValues[w.id] === 1;
    parts.push(
      `<g class="wire-group${on ? ' on' : ''}" data-wire="${w.id}">` +
        `<path class="wire-hit" d="${d}" data-action="snip-wire" data-wire="${w.id}"/>` +
        `<path class="wire-glow" d="${d}"/>` +
        `<path class="wire-core" d="${d}"/>` +
        `<path class="wire-flow" d="${d}"/>` +
      `</g>`,
    );
  }
  svg.innerHTML = parts.join('');
}

function renderHeader(): string {
  const playable = LEVELS.filter(l => !l.sandbox);
  const solved = playable.filter(l => save.completed.includes(l.number)).length;
  const pct = Math.round((solved / playable.length) * 100);
  const soundIcon = save.muted ? '🔇' : '🔊';
  return `<header>
    <button class="brand" data-action="open-drawer"><span class="brand-dot"></span>CHIP LAB</button>
    <button class="hdr-prog" data-action="open-drawer" aria-label="${solved} of ${playable.length} puzzles solved">
      <span class="hp-bar"><i style="width:${pct}%"></i></span>
      <span>${solved}/${playable.length}</span>
    </button>
    <button class="level-pill" data-action="open-drawer">${level.sandbox ? 'Sandbox' : `Level ${level.number}`} ⌄</button>
    <button class="icon-btn${save.muted ? ' muted' : ''}" data-action="toggle-mute" aria-label="Toggle sound">${soundIcon}</button>
    <button class="icon-btn" data-action="open-help" aria-label="Help">?</button>
  </header>`;
}

function renderBoard(): string {
  const inNodes = level.inputs
    .map((pin, i) => {
      const on = boardInputs[i] === 1;
      const armed = armedPin?.node === `IN:${i}` && armedPin.dir === 'out';
      return `<div class="io-node${on ? ' on' : ''}">
        <button class="io-switch" data-action="toggle-input" data-index="${i}" aria-label="Toggle input ${pin.name}">
          <span class="io-label">${esc(pin.name)}</span>
          <span class="sw-pill"></span>
          <span class="io-bit">${on ? '1' : '0'}</span>
        </button>
        <button class="pin${on ? ' on' : ''}${armed ? ' armed' : ''}" data-action="pin" data-node="IN:${i}" data-pin="0" data-dir="out" aria-label="Output pin of ${pin.name}"></button>
      </div>`;
    })
    .join('');

  const outNodes = level.outputs
    .map((pin, i) => {
      const on = sim.boardOutputs[i] === 1;
      const armed = armedPin?.node === `OUT:${i}` && armedPin.dir === 'in';
      return `<div class="io-node c-${pin.color ?? 'green'}${on ? ' on' : ''}">
        <button class="pin${on ? ' on' : ''}${armed ? ' armed' : ''}" data-action="pin" data-node="OUT:${i}" data-pin="0" data-dir="in" aria-label="Input pin of ${pin.name}"></button>
        <span class="lamp-bulb"></span>
        <span class="io-label">${esc(pin.name)}</span>
      </div>`;
    })
    .join('');

  const chipsHtml = circuit.chips
    .map(ch => {
      const spec = CHIPS[ch.kind];
      const outs = sim.outputs[ch.id] ?? [];
      const inPins = spec.inputs
        .map((label, p) => {
          const lit = circuit.wires.some(
            w => w.toNode === ch.id && w.toPin === p && sim.wireValues[w.id] === 1,
          );
          const armed = armedPin?.node === ch.id && armedPin.pin === p && armedPin.dir === 'in';
          return `<div class="pin-row"><button class="pin${lit ? ' on' : ''}${armed ? ' armed' : ''}" data-action="pin" data-node="${ch.id}" data-pin="${p}" data-dir="in" aria-label="${spec.label} input ${label}"></button><span class="pin-tag">${label}</span></div>`;
        })
        .join('');
      const outPins = spec.outputs
        .map((label, p) => {
          const lit = outs[p] === 1;
          const armed = armedPin?.node === ch.id && armedPin.pin === p && armedPin.dir === 'out';
          return `<div class="pin-row"><span class="pin-tag">${label}</span><button class="pin${lit ? ' on' : ''}${armed ? ' armed' : ''}" data-action="pin" data-node="${ch.id}" data-pin="${p}" data-dir="out" aria-label="${spec.label} output ${label}"></button></div>`;
        })
        .join('');

      let body = `<span class="chip-title">${spec.short}</span>`;
      if (spec.sequential) {
        const mem = sim.memory[ch.id] ?? 0;
        body += `<span class="chip-mem${mem ? ' on' : ''}">${mem ? 'ON · 1' : 'OFF · 0'}</span>`;
      } else if (ch.kind === 'SWITCH') {
        const on = ch.value === 1;
        body += `<button class="chip-sw-btn${on ? ' on' : ''}" data-action="flip-chip-sw" data-chip="${ch.id}">${on ? 'ON' : 'OFF'}</button>`;
      } else if (ch.kind === 'LAMP') {
        body = `<span class="chip-lamp${lampLit(ch) ? ' on' : ''}"></span>`;
      } else if (ch.kind === 'SEG7') {
        body = `<span class="seg7">${seg7Char(ch)}</span>`;
      }

      return `<div class="chip f-${spec.family}${selectedChipId === ch.id ? ' selected' : ''}" data-chip="${ch.id}" style="left:${ch.x}px;top:${ch.y}px">
        ${inPins ? `<div class="chip-pins in">${inPins}</div>` : ''}
        <div class="chip-body">${body}</div>
        ${outPins ? `<div class="chip-pins out">${outPins}</div>` : ''}
      </div>`;
    })
    .join('');

  const selChip = selectedChipId ? circuit.chips.find(c => c.id === selectedChipId) : null;
  const swappable = selChip ? compatibleKinds(selChip.kind) : [];

  return `<section class="board-wrap">
    <div class="board">
      <svg class="wires" aria-hidden="true"></svg>
      ${inNodes ? `<div class="rail rail-in">${inNodes}</div>` : ''}
      ${outNodes ? `<div class="rail rail-out">${outNodes}</div>` : ''}
      ${chipsHtml}
      ${toast ? `<div class="board-toast ${toast.kind}">${esc(toast.text)}</div>` : ''}
      <div class="board-bar">
        ${!level.sandbox ? `<button class="bar-btn primary" data-action="check">✓ Check Circuit</button>` : ''}
        ${level.hasClock ? `<button class="bar-btn clock" data-action="tick">⚡ Tick Clock</button><button class="bar-btn" data-action="auto-clock">${autoClockTimer ? '❚❚ Stop' : '▶ Auto'}</button><span class="bar-pill">${sim.ticks} ticks</span>` : ''}
        ${swappable.length ? `<button class="bar-btn swap" data-action="cycle-swap" title="Swap for another ${CHIPS[selChip!.kind].inputs.length}→${CHIPS[selChip!.kind].outputs.length} chip">⇄ ${esc(CHIPS[swappable[0]].short)}</button>` : ''}
        ${selectedChipId ? `<button class="bar-btn danger" data-action="delete-selected">🗑 Remove Chip</button>` : ''}
        <button class="bar-btn" data-action="undo"${undoStack.length ? '' : ' disabled'}>Undo</button>
        <button class="bar-btn" data-action="redo"${redoStack.length ? '' : ' disabled'}>Redo</button>
        <button class="bar-btn" data-action="clear"${circuit.chips.length || circuit.wires.length ? '' : ' disabled'}>Clear</button>
      </div>
    </div>
  </section>`;
}

function renderTests(): string {
  if (level.sandbox) return '';
  const rows =
    validation?.rows ??
    (level.sequence
      ? level.sequence.map(s => ({ inputs: s.inputs, expected: s.expected, actual: [] as Bit[], passed: false, clock: s.clock }))
      : (level.tests ?? []).map(t => ({ inputs: t.inputs, expected: t.expected, actual: [] as Bit[], passed: false, clock: false })));

  const shown = rows.slice(0, 8);
  const headIn = level.inputs.map(p => `<th>${esc(p.name)}</th>`).join('');
  const headOut = level.outputs.map(p => `<th>${esc(p.name)}</th>`).join('');
  const body = shown
    .map((r, idx) => {
      const cls = validation ? (r.passed ? 'pass' : 'fail') : '';
      const clickable = !level.sequence ? ` clickable" data-action="load-row" data-row="${idx}` : '';
      const inCells = r.inputs.map(b => `<td><span class="bit-badge${b ? ' on' : ''}">${b}</span></td>`).join('');
      const outCells = r.expected.map(b => `<td><span class="bit-badge${b ? ' on' : ''}">${b}</span></td>`).join('');
      const status = validation ? (r.passed ? '✓' : '✗') : '·';
      return `<tr class="${cls}${clickable}">${level.sequence ? `<td>${r.clock ? '⚡' : '·'}</td>` : ''}${inCells}${outCells}<td>${status}</td></tr>`;
    })
    .join('');

  return `<div class="card">
    <p class="tray-title">${level.sequence ? 'Clock Sequence' : 'Goal Table (tap a row to try it)'}</p>
    <table class="tests-table">
      <thead><tr>${level.sequence ? '<th>CLK</th>' : ''}${headIn}${headOut}<th>OK</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${rows.length > shown.length ? `<p style="margin-top:6px;font-size:11px;color:var(--muted)">Showing first ${shown.length} of ${rows.length} tests — Check Circuit verifies all ${rows.length}.</p>` : ''}
  </div>`;
}

function renderPanel(): string {
  const chipsTray = level.available.length
    ? `<div class="card">
        <p class="tray-title">Chips (tap to add)</p>
        <div class="tray-grid">
          ${level.available
            .map(kind => {
              const s = CHIPS[kind];
              return `<button class="tray-chip f-${s.family}" data-action="add-chip" data-kind="${kind}" title="${esc(s.description)}"><span>${esc(s.label)}</span><small>${s.inputs.length}→${s.outputs.length}</small></button>`;
            })
            .join('')}
        </div>
      </div>`
    : '';

  const selChip = selectedChipId ? circuit.chips.find(c => c.id === selectedChipId) : null;
  const swappable = selChip ? compatibleKinds(selChip.kind) : [];
  const swapRow = swappable.length
    ? `<div class="swap-row"><span class="swap-label">Swap with:</span>${swappable
        .map(k => `<button class="swap-pill f-${CHIPS[k].family}" data-action="swap-chip" data-kind="${k}">${esc(CHIPS[k].short)}</button>`)
        .join('')}</div>`
    : '';
  const selInfo = selChip
    ? `<div class="card"><p class="tray-title">Selected: ${esc(CHIPS[selChip.kind].label)}</p><p>${esc(CHIPS[selChip.kind].description)}</p>${CHIPS[selChip.kind].tip ? `<p style="margin-top:6px;color:var(--cyan);font-size:12px"><b>Tip:</b> ${esc(CHIPS[selChip.kind].tip)}</p>` : ''}${swapRow}</div>`
    : '';

  return `<aside class="panel">
    <div>
      <p class="eyebrow">${esc(level.section)} · ${level.sandbox ? 'Free Play' : `Level ${level.number}`}</p>
      <h1>${esc(level.name)}</h1>
    </div>
    <div class="card">
      <p>${esc(level.instructions)}</p>
      <div class="meta-row">
        <span>${circuit.chips.length} chip${circuit.chips.length === 1 ? '' : 's'} placed</span>
        ${level.parChips !== undefined ? `<span class="star-goal">★ Goal: ≤ ${level.parChips} chip${level.parChips === 1 ? '' : 's'}</span>` : ''}
      </div>
      ${level.hint ? `<button class="hint-toggle" data-action="toggle-hint">${hintOpen ? 'Hide hint' : 'Need a hint?'}</button>${hintOpen ? `<div class="hint-box">${esc(level.hint)}</div>` : ''}` : ''}
    </div>
    ${chipsTray}
    ${selInfo}
    ${renderTests()}
  </aside>`;
}

function renderDrawer(): string {
  const cards = LEVELS.map(l => {
    const done = save.completed.includes(l.number);
    const best = save.bestChips[l.number];
    const star = done && l.parChips !== undefined && best !== undefined && best <= l.parChips;
    return `<button class="lvl-card${l.number === level.number ? ' selected' : ''}${done ? ' done' : ''}" data-action="select-level" data-level="${l.number}">
      <span class="lvl-num">${done ? '✓' : l.sandbox ? '✦' : l.number}</span>
      <span><b>${esc(l.name)}</b><small>${esc(l.section)}</small></span>
      ${star ? '<span class="lvl-star" aria-label="Star earned">★</span>' : ''}
    </button>`;
  }).join('');
  return `<div class="backdrop drawer-backdrop" data-backdrop="close-drawer">
    <div class="drawer" role="dialog" aria-modal="true" aria-label="Choose a level">
      <div class="drawer-head"><h2>Chip Lab Levels</h2><button class="icon-btn" data-action="close-drawer" aria-label="Close">×</button></div>
      <div class="level-grid">${cards}</div>
    </div>
  </div>`;
}

function renderSuccess(): string {
  if (!successModal) return '';
  const unlock = level.unlocks ? CHIPS[level.unlocks] : null;
  const hasNext = LEVELS.some(l => l.number === level.number + 1);
  return `<div class="backdrop" data-backdrop="close-success">
    <section class="modal" role="dialog" aria-modal="true">
      <div style="font-size:44px">⚡</div>
      <p class="eyebrow">LEVEL ${level.number} COMPLETE</p>
      <h2>${esc(level.name)} — works!</h2>
      ${unlock ? `<div class="unlock-pill">🔓 Unlocked Chip: ${esc(unlock.label)}</div>` : ''}
      <div class="modal-stats">
        <div><b>${successModal.rows.length}/${successModal.rows.length}</b><span>tests passed</span></div>
        <div class="${successModal.star ? 'star' : ''}"><b>${successModal.chipCount}</b><span>chip${successModal.chipCount === 1 ? '' : 's'}${level.parChips !== undefined ? ` · ★ ≤ ${level.parChips}` : ''}</span></div>
      </div>
      ${hasNext ? `<button class="bar-btn primary wide-btn" data-action="next-level">Next Level →</button>` : ''}
      <button class="text-link" data-action="close-success">Keep tinkering</button>
    </section>
  </div>`;
}

function renderHelp(): string {
  return `<div class="backdrop" data-backdrop="close-help">
    <section class="modal" role="dialog" aria-modal="true" style="text-align:left">
      <p class="eyebrow">HOW TO PLAY</p>
      <h2>Wire up your own computer chips</h2>
      <p style="color:#dbe6fc;line-height:1.5;font-size:14px">
        <b>1. Add chips:</b> Tap any chip in the toolbox to drop it on the breadboard, then drag it wherever you like.<br><br>
        <b>2. Connect wires:</b> Tap an output pin (right side) then an input pin (left side) — or drag a wire straight from one pin to another.<br><br>
        <b>3. Snip wires:</b> Tap any wire to remove it.<br><br>
        <b>4. Test &amp; Check:</b> Flip switches on the left to watch glowing signals travel live, then press <b>Check Circuit</b> to verify every combination!
      </p>
      <button class="bar-btn primary wide-btn" data-action="close-help">Got it!</button>
    </section>
  </div>`;
}

function render(): void {
  app.innerHTML = `${renderHeader()}<main class="stage">${renderBoard()}${renderPanel()}</main>${drawerOpen ? renderDrawer() : ''}${successModal ? renderSuccess() : ''}${helpOpen ? renderHelp() : ''}`;
  renderWiresSvg();
}

// Click delegation
app.addEventListener('click', event => {
  const clicked = event.target as HTMLElement;
  const target = clicked.closest<HTMLElement>('[data-action]') ?? (clicked.dataset.backdrop ? clicked : null);
  if (!target) {
    if (clicked.closest('.board') && !clicked.closest('.chip, .io-node, .board-bar')) {
      if (selectedChipId || armedPin) {
        selectedChipId = null;
        armedPin = null;
        render();
      }
    }
    return;
  }
  const action = target.dataset.action ?? target.dataset.backdrop;
  if (action === 'open-drawer') { drawerOpen = true; render(); }
  else if (action === 'close-drawer') { drawerOpen = false; render(); }
  else if (action === 'open-help') { helpOpen = true; render(); }
  else if (action === 'close-help') { helpOpen = false; render(); }
  else if (action === 'close-success') { successModal = null; render(); }
  else if (action === 'select-level') { selectLevel(Number(target.dataset.level)); }
  else if (action === 'next-level') { selectLevel(level.number + 1); }
  else if (action === 'toggle-mute') { save.muted = !save.muted; setMuted(save.muted); writeSave(save); render(); }
  else if (action === 'toggle-hint') { hintOpen = !hintOpen; render(); }
  else if (action === 'add-chip') { addChip(target.dataset.kind as ChipKind); }
  else if (action === 'swap-chip' && selectedChipId) { swapChip(selectedChipId, target.dataset.kind as ChipKind); }
  else if (action === 'cycle-swap' && selectedChipId) {
    const ch = circuit.chips.find(c => c.id === selectedChipId);
    const alts = ch ? compatibleKinds(ch.kind) : [];
    if (alts.length) swapChip(selectedChipId, alts[0]);
  }
  else if (action === 'delete-selected' && selectedChipId) { removeChip(selectedChipId); }
  else if (action === 'snip-wire') { removeWire(target.dataset.wire!); }
  else if (action === 'undo') { undo(); }
  else if (action === 'redo') { redo(); }
  else if (action === 'clear') { clearBoard(); }
  else if (action === 'check') { checkCircuit(); }
  else if (action === 'tick') { doClockTick(); }
  else if (action === 'auto-clock') { toggleAutoClock(); }
  else if (action === 'toggle-input') {
    const i = Number(target.dataset.index);
    boardInputs[i] = boardInputs[i] ? 0 : 1;
    sfx.toggle(boardInputs[i] === 1);
    recompute();
    render();
  } else if (action === 'flip-chip-sw') {
    const ch = circuit.chips.find(c => c.id === target.dataset.chip);
    if (ch) {
      ch.value = ch.value ? 0 : 1;
      sfx.toggle(ch.value === 1);
      recompute();
      persist();
      render();
    }
  } else if (action === 'load-row') {
    const row = (level.tests ?? [])[Number(target.dataset.row)];
    if (row) {
      boardInputs = [...row.inputs];
      sfx.toggle(true);
      recompute();
      render();
    }
  } else if (action === 'pin') {
    const node = target.dataset.node!;
    const pin = Number(target.dataset.pin);
    const dir = target.dataset.dir as 'out' | 'in';
    if (!armedPin) {
      armedPin = { node, pin, dir };
      render();
    } else if (armedPin.node === node && armedPin.pin === pin && armedPin.dir === dir) {
      armedPin = null;
      render();
    } else if (armedPin.dir !== dir) {
      const from = armedPin.dir === 'out' ? armedPin : { node, pin };
      const to = armedPin.dir === 'in' ? armedPin : { node, pin };
      armedPin = null;
      connectWire(from.node, from.pin, to.node, to.pin);
    } else {
      armedPin = { node, pin, dir };
      render();
    }
  }
});

// Pointer drag: move chips on breadboard OR drag a live wire from any pin
let chipDrag: { chip: PlacedChip; el: HTMLElement; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null = null;
let wireDrag: { node: string; pin: number; dir: 'out' | 'in'; startX: number; startY: number; moved: boolean } | null = null;

app.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const t = event.target as HTMLElement;

  const pinEl = t.closest<HTMLElement>('.pin');
  if (pinEl) {
    const board = app.querySelector<HTMLElement>('.board');
    if (!board) return;
    const b = board.getBoundingClientRect();
    const r = pinEl.getBoundingClientRect();
    wireDrag = {
      node: pinEl.dataset.node!,
      pin: Number(pinEl.dataset.pin),
      dir: pinEl.dataset.dir as 'out' | 'in',
      startX: r.left - b.left + r.width / 2,
      startY: r.top - b.top + r.height / 2,
      moved: false,
    };
    return;
  }

  if (t.closest('.chip-sw-btn')) return;
  const chipEl = t.closest<HTMLElement>('.chip');
  if (chipEl) {
    const chip = circuit.chips.find(c => c.id === chipEl.dataset.chip);
    if (!chip) return;
    event.preventDefault();
    chipDrag = {
      chip,
      el: chipEl,
      startX: event.clientX,
      startY: event.clientY,
      origX: chip.x,
      origY: chip.y,
      moved: false,
    };
    if (selectedChipId !== chip.id) {
      selectedChipId = chip.id;
      app.querySelectorAll('.chip.selected').forEach(el => el.classList.remove('selected'));
      chipEl.classList.add('selected');
    }
  }
});

window.addEventListener('pointermove', event => {
  if (wireDrag) {
    const board = app.querySelector<HTMLElement>('.board');
    const svg = app.querySelector<SVGSVGElement>('.wires');
    if (!board || !svg) return;
    const b = board.getBoundingClientRect();
    const mx = event.clientX - b.left;
    const my = event.clientY - b.top;
    if (!wireDrag.moved && Math.hypot(mx - wireDrag.startX, my - wireDrag.startY) < 8) return;
    wireDrag.moved = true;
    let draft = svg.querySelector<SVGPathElement>('.wire-draft');
    if (!draft) {
      draft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      draft.setAttribute('class', 'wire-draft');
      svg.appendChild(draft);
    }
    const d =
      wireDrag.dir === 'out'
        ? wirePath(wireDrag.startX, wireDrag.startY, mx, my)
        : wirePath(mx, my, wireDrag.startX, wireDrag.startY);
    draft.setAttribute('d', d);
    return;
  }

  if (chipDrag) {
    const dx = event.clientX - chipDrag.startX;
    const dy = event.clientY - chipDrag.startY;
    if (!chipDrag.moved && Math.hypot(dx, dy) < 4) return;
    if (!chipDrag.moved) {
      pushUndo();
      chipDrag.moved = true;
    }
    const board = app.querySelector<HTMLElement>('.board');
    const bw = board?.clientWidth ?? 640;
    const bh = board?.clientHeight ?? 440;
    const nx = Math.round((chipDrag.origX + dx) / GRID) * GRID;
    const ny = Math.round((chipDrag.origY + dy) / GRID) * GRID;
    chipDrag.chip.x = Math.max(90, Math.min(bw - 180, nx));
    chipDrag.chip.y = Math.max(16, Math.min(bh - 130, ny));
    chipDrag.el.style.left = `${chipDrag.chip.x}px`;
    chipDrag.el.style.top = `${chipDrag.chip.y}px`;
    renderWiresSvg();
  }
});

window.addEventListener('pointerup', event => {
  if (wireDrag) {
    const wd = wireDrag;
    wireDrag = null;
    app.querySelector('.wire-draft')?.remove();
    if (wd.moved) {
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.pin');
      if (under) {
        const node = under.dataset.node!;
        const pin = Number(under.dataset.pin);
        const dir = under.dataset.dir as 'out' | 'in';
        if (dir !== wd.dir) {
          const from = wd.dir === 'out' ? wd : { node, pin };
          const to = wd.dir === 'in' ? wd : { node, pin };
          armedPin = null;
          connectWire(from.node, from.pin, to.node, to.pin);
        }
      }
    }
    return;
  }

  if (chipDrag) {
    const moved = chipDrag.moved;
    chipDrag = null;
    if (moved) persist();
    render();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    drawerOpen = false;
    helpOpen = false;
    successModal = null;
    armedPin = null;
    selectedChipId = null;
    render();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedChipId) {
    event.preventDefault();
    removeChip(selectedChipId);
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});

window.addEventListener('resize', () => renderWiresSvg());

render();
