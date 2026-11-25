export type Bit = 0 | 1;

export type ChipKind =
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'XOR'
  | 'XNOR'
  | 'MUX'
  | 'HALF_ADD'
  | 'FULL_ADD'
  | 'D_FF'
  | 'TOGGLE'
  | 'SWITCH'
  | 'CLOCK'
  | 'LAMP'
  | 'SEG7';

export interface ChipSpec {
  kind: ChipKind;
  label: string;
  short: string;
  family: 'basic' | 'combo' | 'math' | 'memory' | 'io';
  inputs: string[];
  outputs: string[];
  description: string;
  tip?: string;
  sequential?: boolean;
}

export interface PlacedChip {
  id: string;
  kind: ChipKind;
  x: number; // grid column
  y: number; // grid row
  /** Used for SWITCH manual toggle in sandbox */
  value?: Bit;
}

export interface Wire {
  id: string;
  /** 'IN:<index>' for board input pins, or chip id */
  fromNode: string;
  fromPin: number;
  /** 'OUT:<index>' for board output lamps, or chip id */
  toNode: string;
  toPin: number;
}

export interface Circuit {
  chips: PlacedChip[];
  wires: Wire[];
}

export interface BoardPin {
  name: string;
  color?: 'green' | 'red' | 'yellow' | 'blue';
}

export interface TestCase {
  /** Input values per board input pin. For sequential tests, each step is a clock tick. */
  inputs: Bit[];
  expected: Bit[];
  /** Optional label for the test row */
  note?: string;
}

export interface SequenceStep {
  inputs: Bit[];
  /** If true, trigger a rising clock edge before reading outputs */
  clock?: boolean;
  expected: Bit[];
}

export interface Level {
  number: number;
  name: string;
  section: 'Basics' | 'Logic' | 'Binary Math' | 'Memory & Clocks' | 'Sandbox';
  instructions: string;
  hint?: string;
  inputs: BoardPin[];
  outputs: BoardPin[];
  available: ChipKind[];
  /** Chip unlocked and added to your toolbox when you solve this puzzle */
  unlocks?: ChipKind;
  /** Optional ★ star target: max number of placed chips */
  parChips?: number;
  /** Combinational truth-table tests */
  tests?: TestCase[];
  /** Sequential multi-step tests (clocked memory / counters) */
  sequence?: SequenceStep[];
  sandbox?: boolean;
  /** Whether the board has a manual/auto clock bar */
  hasClock?: boolean;
}

export interface SimState {
  /** Output values of every node: 'IN:0' -> [bit], chipId -> [out0, out1, ...] */
  outputs: Record<string, Bit[]>;
  /** Internal stored bit per sequential chip (D_FF, TOGGLE) */
  memory: Record<string, Bit>;
  /** Current value on each wire id */
  wireValues: Record<string, Bit>;
  /** Current value arriving at each board output pin */
  boardOutputs: Bit[];
  /** Clock pulse count */
  ticks: number;
}

export interface TestRowResult {
  inputs: Bit[];
  expected: Bit[];
  actual: Bit[];
  passed: boolean;
  clock?: boolean;
}

export interface ValidationResult {
  passed: boolean;
  rows: TestRowResult[];
  chipCount: number;
  star: boolean;
}
