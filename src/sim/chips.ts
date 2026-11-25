import type { Bit, ChipKind, ChipSpec } from './types';

export const CHIPS: Record<ChipKind, ChipSpec> = {
  NOT: {
    kind: 'NOT',
    label: 'NOT',
    short: 'NOT',
    family: 'basic',
    inputs: ['IN'],
    outputs: ['OUT'],
    description: 'Flips the signal: ON becomes OFF, OFF becomes ON.',
    tip: 'Great for making something happen when a switch is OFF.',
  },
  AND: {
    kind: 'AND',
    label: 'AND',
    short: 'AND',
    family: 'basic',
    inputs: ['A', 'B'],
    outputs: ['OUT'],
    description: 'Turns ON only when BOTH inputs A and B are ON.',
    tip: 'Think of a vault that needs two keys at the same time.',
  },
  OR: {
    kind: 'OR',
    label: 'OR',
    short: 'OR',
    family: 'basic',
    inputs: ['A', 'B'],
    outputs: ['OUT'],
    description: 'Turns ON when input A, input B, or both are ON.',
    tip: 'Like a doorbell with buttons at the front and back doors.',
  },
  XOR: {
    kind: 'XOR',
    label: 'XOR',
    short: 'XOR',
    family: 'combo',
    inputs: ['A', 'B'],
    outputs: ['OUT'],
    description: 'Turns ON when A and B are DIFFERENT (one ON, one OFF).',
    tip: 'Also works as 1-bit addition without the carry!',
  },
  XNOR: {
    kind: 'XNOR',
    label: 'SAME',
    short: 'SAME',
    family: 'combo',
    inputs: ['A', 'B'],
    outputs: ['OUT'],
    description: 'Turns ON when A and B are the SAME (both ON or both OFF).',
    tip: 'Super handy for checking if two binary numbers match.',
  },
  MUX: {
    kind: 'MUX',
    label: 'SWITCH (MUX)',
    short: 'MUX',
    family: 'combo',
    inputs: ['A', 'B', 'SEL'],
    outputs: ['OUT'],
    description: 'Picks A when SEL is OFF, or picks B when SEL is ON.',
    tip: 'Like a railroad track switch choosing which signal goes through.',
  },
  HALF_ADD: {
    kind: 'HALF_ADD',
    label: 'HALF ADDER',
    short: 'H-ADD',
    family: 'math',
    inputs: ['A', 'B'],
    outputs: ['SUM', 'CRY'],
    description: 'Adds two 1-bit numbers: outputs SUM and CARRY.',
    tip: '1 + 1 = 0 with a CARRY of 1 (binary 10 = 2!).',
  },
  FULL_ADD: {
    kind: 'FULL_ADD',
    label: 'FULL ADDER',
    short: 'F-ADD',
    family: 'math',
    inputs: ['A', 'B', 'CIN'],
    outputs: ['SUM', 'COUT'],
    description: 'Adds A + B + Carry-In: outputs SUM and Carry-Out.',
    tip: 'Chain Full Adders together to add numbers of any size!',
  },
  D_FF: {
    kind: 'D_FF',
    label: 'MEMORY BIT',
    short: 'MEM',
    family: 'memory',
    inputs: ['DATA'],
    outputs: ['Q'],
    description: 'Remembers DATA whenever the Clock ticks, and holds it on Q.',
    tip: 'Even if DATA turns off later, Q remembers until the next clock tick!',
    sequential: true,
  },
  TOGGLE: {
    kind: 'TOGGLE',
    label: 'TOGGLE',
    short: 'TGL',
    family: 'memory',
    inputs: ['EN'],
    outputs: ['Q'],
    description: 'Flips Q (ON ↔ OFF) on each clock tick while EN is ON.',
    tip: 'Wire Q of one Toggle into EN of the next to count in binary!',
    sequential: true,
  },
  SWITCH: {
    kind: 'SWITCH',
    label: 'SWITCH',
    short: 'SW',
    family: 'io',
    inputs: [],
    outputs: ['OUT'],
    description: 'A manual toggle switch you can tap on the breadboard.',
  },
  CLOCK: {
    kind: 'CLOCK',
    label: 'PULSE',
    short: 'CLK',
    family: 'io',
    inputs: [],
    outputs: ['OUT'],
    description: 'Flips ON/OFF every time the Clock ticks.',
    sequential: true,
  },
  LAMP: {
    kind: 'LAMP',
    label: 'LAMP',
    short: 'LED',
    family: 'io',
    inputs: ['IN'],
    outputs: [],
    description: 'A glowing LED bulb you can place anywhere on the board.',
  },
  SEG7: {
    kind: 'SEG7',
    label: 'DIGIT DISPLAY',
    short: '0–F',
    family: 'io',
    inputs: ['8', '4', '2', '1'],
    outputs: [],
    description: 'Shows a 4-bit binary number (8-4-2-1) as a glowing digit!',
  },
};

export function evalCombinational(kind: ChipKind, inp: Bit[], mem: Bit, manual?: Bit): Bit[] {
  const a = inp[0] ?? 0;
  const b = inp[1] ?? 0;
  const c = inp[2] ?? 0;
  switch (kind) {
    case 'NOT':
      return [a ? 0 : 1];
    case 'AND':
      return [a && b ? 1 : 0];
    case 'OR':
      return [a || b ? 1 : 0];
    case 'XOR':
      return [a !== b ? 1 : 0];
    case 'XNOR':
      return [a === b ? 1 : 0];
    case 'MUX':
      return [c ? b : a];
    case 'HALF_ADD': {
      const sum = a + b;
      return [(sum & 1) as Bit, (sum >> 1) as Bit];
    }
    case 'FULL_ADD': {
      const sum = a + b + c;
      return [(sum & 1) as Bit, (sum >> 1) as Bit];
    }
    case 'D_FF':
    case 'TOGGLE':
    case 'CLOCK':
      return [mem];
    case 'SWITCH':
      return [manual ?? 0];
    case 'LAMP':
    case 'SEG7':
      return [];
  }
}

export function nextMemory(kind: ChipKind, inp: Bit[], mem: Bit): Bit {
  if (kind === 'D_FF') return inp[0] ?? 0;
  if (kind === 'TOGGLE') return inp[0] ? (mem ? 0 : 1) : mem;
  if (kind === 'CLOCK') return mem ? 0 : 1;
  return mem;
}
