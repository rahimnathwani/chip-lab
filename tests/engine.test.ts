import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/data/levels';
import { validateCircuit } from '../src/sim/engine';
import type { Circuit } from '../src/sim/types';

const level = (n: number) => LEVELS.find(l => l.number === n)!;

describe('Chip Lab simulation engine', () => {
  it('Level 1 (First Spark): direct wire passes', () => {
    const circuit: Circuit = {
      chips: [],
      wires: [{ id: 'w1', fromNode: 'IN:0', fromPin: 0, toNode: 'OUT:0', toPin: 0 }],
    };
    const res = validateCircuit(level(1), circuit);
    expect(res.passed).toBe(true);
    expect(res.star).toBe(true);
  });

  it('Level 5 (Build an XOR Chip): NOT + AND + OR solution passes with star', () => {
    const circuit: Circuit = {
      chips: [
        { id: 'or1', kind: 'OR', x: 0, y: 0 },
        { id: 'and1', kind: 'AND', x: 0, y: 0 },
        { id: 'not1', kind: 'NOT', x: 0, y: 0 },
        { id: 'and2', kind: 'AND', x: 0, y: 0 },
      ],
      wires: [
        { id: 'w1', fromNode: 'IN:0', fromPin: 0, toNode: 'or1', toPin: 0 },
        { id: 'w2', fromNode: 'IN:1', fromPin: 0, toNode: 'or1', toPin: 1 },
        { id: 'w3', fromNode: 'IN:0', fromPin: 0, toNode: 'and1', toPin: 0 },
        { id: 'w4', fromNode: 'IN:1', fromPin: 0, toNode: 'and1', toPin: 1 },
        { id: 'w5', fromNode: 'and1', fromPin: 0, toNode: 'not1', toPin: 0 },
        { id: 'w6', fromNode: 'or1', fromPin: 0, toNode: 'and2', toPin: 0 },
        { id: 'w7', fromNode: 'not1', fromPin: 0, toNode: 'and2', toPin: 1 },
        { id: 'w8', fromNode: 'and2', fromPin: 0, toNode: 'OUT:0', toPin: 0 },
      ],
    };
    const res = validateCircuit(level(5), circuit);
    expect(res.passed).toBe(true);
    expect(res.star).toBe(true);
  });

  it('Level 12 (2-Bit Calculator): HALF_ADD + FULL_ADD solves all 16 input combinations', () => {
    const circuit: Circuit = {
      chips: [
        { id: 'ha', kind: 'HALF_ADD', x: 0, y: 0 },
        { id: 'fa', kind: 'FULL_ADD', x: 0, y: 0 },
      ],
      wires: [
        // A0 = IN:1, B0 = IN:3 -> HALF_ADD -> S0 (OUT:2) & CARRY -> FA.CIN
        { id: 'w1', fromNode: 'IN:1', fromPin: 0, toNode: 'ha', toPin: 0 },
        { id: 'w2', fromNode: 'IN:3', fromPin: 0, toNode: 'ha', toPin: 1 },
        { id: 'w3', fromNode: 'ha', fromPin: 0, toNode: 'OUT:2', toPin: 0 },
        { id: 'w4', fromNode: 'ha', fromPin: 1, toNode: 'fa', toPin: 2 },
        // A1 = IN:0, B1 = IN:2 -> FULL_ADD -> S1 (OUT:1) & S2 (OUT:0)
        { id: 'w5', fromNode: 'IN:0', fromPin: 0, toNode: 'fa', toPin: 0 },
        { id: 'w6', fromNode: 'IN:2', fromPin: 0, toNode: 'fa', toPin: 1 },
        { id: 'w7', fromNode: 'fa', fromPin: 0, toNode: 'OUT:1', toPin: 0 },
        { id: 'w8', fromNode: 'fa', fromPin: 1, toNode: 'OUT:0', toPin: 0 },
      ],
    };
    const res = validateCircuit(level(12), circuit);
    expect(res.passed).toBe(true);
    expect(res.rows).toHaveLength(16);
    expect(res.star).toBe(true);
  });

  it('Level 16 (Blinking Beacon): D_FF + NOT feedback toggles every clock tick', () => {
    const circuit: Circuit = {
      chips: [
        { id: 'mem', kind: 'D_FF', x: 0, y: 0 },
        { id: 'inv', kind: 'NOT', x: 0, y: 0 },
      ],
      wires: [
        { id: 'w1', fromNode: 'mem', fromPin: 0, toNode: 'OUT:0', toPin: 0 },
        { id: 'w2', fromNode: 'mem', fromPin: 0, toNode: 'inv', toPin: 0 },
        { id: 'w3', fromNode: 'inv', fromPin: 0, toNode: 'mem', toPin: 0 },
      ],
    };
    const res = validateCircuit(level(16), circuit);
    expect(res.passed).toBe(true);
    expect(res.star).toBe(true);
  });

  it('Level 17 (2-Bit Binary Counter): two TOGGLEs + AND count 00->01->10->11->00', () => {
    const circuit: Circuit = {
      chips: [
        { id: 't0', kind: 'TOGGLE', x: 0, y: 0 },
        { id: 'a1', kind: 'AND', x: 0, y: 0 },
        { id: 't1', kind: 'TOGGLE', x: 0, y: 0 },
      ],
      wires: [
        { id: 'w1', fromNode: 'IN:0', fromPin: 0, toNode: 't0', toPin: 0 },
        { id: 'w2', fromNode: 't0', fromPin: 0, toNode: 'OUT:1', toPin: 0 },
        { id: 'w3', fromNode: 'IN:0', fromPin: 0, toNode: 'a1', toPin: 0 },
        { id: 'w4', fromNode: 't0', fromPin: 0, toNode: 'a1', toPin: 1 },
        { id: 'w5', fromNode: 'a1', fromPin: 0, toNode: 't1', toPin: 0 },
        { id: 'w6', fromNode: 't1', fromPin: 0, toNode: 'OUT:0', toPin: 0 },
      ],
    };
    const res = validateCircuit(level(17), circuit);
    expect(res.passed).toBe(true);
    expect(res.star).toBe(true);
  });
});
