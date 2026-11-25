import { CHIPS, evalCombinational, nextMemory } from './chips';
import type { Bit, Circuit, Level, SimState, TestRowResult, ValidationResult } from './types';

export function createSimState(level: Level): SimState {
  return {
    outputs: {},
    memory: {},
    wireValues: {},
    boardOutputs: level.outputs.map(() => 0),
    ticks: 0,
  };
}

/**
 * Propagates all combinational signals through the circuit until stable
 * (with a fixed iteration cap so feedback loops settle safely without hanging).
 */
export function evaluateCircuit(
  level: Level,
  circuit: Circuit,
  boardInputs: Bit[],
  previousMemory: Record<string, Bit> = {},
  ticks = 0,
): SimState {
  const outputs: Record<string, Bit[]> = {};
  const memory: Record<string, Bit> = {};

  level.inputs.forEach((_, i) => {
    outputs[`IN:${i}`] = [boardInputs[i] ?? 0];
  });
  for (const chip of circuit.chips) {
    const spec = CHIPS[chip.kind];
    memory[chip.id] = previousMemory[chip.id] ?? 0;
    outputs[chip.id] = spec.outputs.map(() => 0);
  }

  // Build quick lookup for incoming wires to each (node, pin).
  // Multiple wires into the same input pin combine with wired-OR (intuitive for kids).
  const incoming = new Map<string, Array<{ fromNode: string; fromPin: number }>>();
  for (const w of circuit.wires) {
    const key = `${w.toNode}:${w.toPin}`;
    let list = incoming.get(key);
    if (!list) {
      list = [];
      incoming.set(key, list);
    }
    list.push({ fromNode: w.fromNode, fromPin: w.fromPin });
  }

  const readInput = (nodeId: string, pin: number): Bit => {
    const sources = incoming.get(`${nodeId}:${pin}`);
    if (!sources) return 0;
    for (const s of sources) {
      if ((outputs[s.fromNode]?.[s.fromPin] ?? 0) === 1) return 1;
    }
    return 0;
  };

  // Fixed-point relaxation: at most chips.length + 4 passes.
  const maxPasses = Math.max(4, circuit.chips.length + 4);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const chip of circuit.chips) {
      const spec = CHIPS[chip.kind];
      const inp = spec.inputs.map((_, p) => readInput(chip.id, p));
      const next = evalCombinational(chip.kind, inp, memory[chip.id] ?? 0, chip.value);
      const prev = outputs[chip.id];
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) {
          prev[i] = next[i];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const wireValues: Record<string, Bit> = {};
  for (const w of circuit.wires) {
    wireValues[w.id] = outputs[w.fromNode]?.[w.fromPin] ?? 0;
  }

  const boardOutputs: Bit[] = level.outputs.map((_, i) => readInput(`OUT:${i}`, 0));
  return { outputs, memory, wireValues, boardOutputs, ticks };
}

/**
 * Advances all sequential chips (D_FF, TOGGLE, CLOCK) by one rising clock edge,
 * sampling their current inputs simultaneously before updating their stored bits.
 */
export function tickClock(
  level: Level,
  circuit: Circuit,
  boardInputs: Bit[],
  current: SimState,
): SimState {
  // First ensure combinational inputs are settled against current memory.
  const settled = evaluateCircuit(level, circuit, boardInputs, current.memory, current.ticks);
  const incoming = new Map<string, Array<{ fromNode: string; fromPin: number }>>();
  for (const w of circuit.wires) {
    const key = `${w.toNode}:${w.toPin}`;
    const list = incoming.get(key) ?? [];
    list.push({ fromNode: w.fromNode, fromPin: w.fromPin });
    incoming.set(key, list);
  }
  const readInput = (nodeId: string, pin: number): Bit => {
    const sources = incoming.get(`${nodeId}:${pin}`);
    if (!sources) return 0;
    for (const s of sources) {
      if ((settled.outputs[s.fromNode]?.[s.fromPin] ?? 0) === 1) return 1;
    }
    return 0;
  };

  const nextMem: Record<string, Bit> = { ...settled.memory };
  for (const chip of circuit.chips) {
    const spec = CHIPS[chip.kind];
    if (!spec.sequential) continue;
    const inp = spec.inputs.map((_, p) => readInput(chip.id, p));
    nextMem[chip.id] = nextMemory(chip.kind, inp, settled.memory[chip.id] ?? 0);
  }
  return evaluateCircuit(level, circuit, boardInputs, nextMem, current.ticks + 1);
}

export function sameBits(a: Bit[], b: Bit[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function validateCircuit(level: Level, circuit: Circuit): ValidationResult {
  const chipCount = circuit.chips.length;
  const star = level.parChips !== undefined && chipCount <= level.parChips;

  if (level.sequence) {
    let state = createSimState(level);
    const rows: TestRowResult[] = level.sequence.map(step => {
      state = step.clock
        ? tickClock(level, circuit, step.inputs, state)
        : evaluateCircuit(level, circuit, step.inputs, state.memory, state.ticks);
      const actual = [...state.boardOutputs];
      return {
        inputs: step.inputs,
        expected: step.expected,
        actual,
        passed: sameBits(actual, step.expected),
        clock: step.clock,
      };
    });
    return {
      passed: rows.length > 0 && rows.every(r => r.passed),
      rows,
      chipCount,
      star,
    };
  }

  const tests = level.tests ?? [];
  const rows: TestRowResult[] = tests.map(tc => {
    const state = evaluateCircuit(level, circuit, tc.inputs);
    const actual = [...state.boardOutputs];
    return {
      inputs: tc.inputs,
      expected: tc.expected,
      actual,
      passed: sameBits(actual, tc.expected),
    };
  });
  return {
    passed: rows.length > 0 && rows.every(r => r.passed),
    rows,
    chipCount,
    star,
  };
}
