import assert from "node:assert/strict";
import test from "node:test";
import { musicLayoutAddresses } from "../src/music-layout-addresses.ts";

const MATRIX_ROWS = 48;
const LOOP_COLUMNS = 9;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];
const ARRAY_FIRST_ROW = 12;
const mod = (value, count) => ((value % count) + count) % count;
const cellKey = cell => `${cell.lane}:${cell.row}`;
const identityKey = cell => `${cell.lane}:${cell.row}:${cell.foobarEntryKey}`;

function nearestOccurrence(value, center, period) {
  return value + Math.floor((center - value + period / 2) / period) * period;
}

function makeCatalog(columnLengths) {
  const catalog = new Map();
  const slotsByLane = new Map();
  let order = 0;
  for (let lane = 0; lane < columnLengths.length; lane++) {
    const slots = [];
    for (let row = 0; row < columnLengths[lane]; row++) {
      const foobarEntryKey = `record-${order}`;
      const slot = { lane, row: ARRAY_FIRST_ROW + row, order };
      catalog.set(foobarEntryKey, slot);
      slots.push({ ...slot, foobarEntryKey });
      order++;
    }
    slotsByLane.set(lane, slots);
  }
  return { catalog, slotsByLane };
}

function makeMatrixPool(columnLengths, slotsByLane, matrixSelection) {
  const columns = columnLengths.length;
  const cells = [];
  for (let index = 0; index < LOOP_COLUMNS * MATRIX_ROWS; index++) {
    const baseLane = POOL_LANES[Math.floor(index / MATRIX_ROWS)];
    const baseRow = index % MATRIX_ROWS - (MATRIX_ROWS - 32) / 2;
    const lane = nearestOccurrence(baseLane, matrixSelection.lane, LOOP_COLUMNS);
    const row = nearestOccurrence(baseRow, matrixSelection.row, MATRIX_ROWS);
    const shelf = mod(lane, columns);
    const slots = slotsByLane.get(shelf) ?? [];
    const slot = slots.length ? slots[mod(row - ARRAY_FIRST_ROW, slots.length)] : undefined;
    cells.push({ lane, row, ...(slot ? { foobarEntryKey: slot.foobarEntryKey } : {}) });
  }
  return cells;
}

function fixture(columnLengths, selectedOrder, cycles) {
  const { catalog, slotsByLane } = makeCatalog(columnLengths);
  const selectedEntry = [...catalog.entries()].find(([, slot]) => slot.order === selectedOrder);
  assert.ok(selectedEntry, `selected order ${selectedOrder} exists`);
  const [foobarEntryKey, selectedSlot] = selectedEntry;
  const arraySelection = { lane: selectedSlot.lane, row: selectedSlot.row, foobarEntryKey };
  const matrixSelection = { lane: selectedSlot.lane + columnLengths.length,
    row: selectedSlot.row + cycles * columnLengths[selectedSlot.lane], foobarEntryKey };
  const matrixCells = makeMatrixPool(columnLengths, slotsByLane, matrixSelection);
  return { catalog, columnLengths, arraySelection, matrixSelection, matrixCells };
}

function checkFixture(fixtureValue, expectedOffsets = {}) {
  const { catalog, columnLengths, arraySelection, matrixSelection, matrixCells } = fixtureValue;
  const addresses = musicLayoutAddresses(catalog, arraySelection, matrixSelection, matrixCells);
  const poolByAddress = new Map(matrixCells.map(cell => [cellKey(cell), cell]));
  assert.equal(matrixCells.length, LOOP_COLUMNS * MATRIX_ROWS, "the full 9×48 MATRIX pool is represented");
  assert.equal(poolByAddress.size, matrixCells.length, "every physical MATRIX address is unique");
  assert.ok(matrixCells.every(cell => cell.foobarEntryKey), "every MATRIX pool slot contains a real repeated entry");

  const physicalLanes = [...new Set(matrixCells.map(cell => cell.lane))];
  assert.equal(physicalLanes.length, LOOP_COLUMNS, "all nine MATRIX lanes are present");
  for (const lane of physicalLanes) {
    const rows = matrixCells.filter(cell => cell.lane === lane).map(cell => cell.row).sort((a, b) => a - b);
    assert.equal(rows.length, MATRIX_ROWS, `lane ${lane} has all 48 cells`);
    for (let index = 1; index < rows.length; index++)
      assert.equal(rows[index], rows[index - 1] + 1, `lane ${lane} has no physical row gaps`);
  }

  const arrayAddresses = matrixCells.map(cell => addresses.toArray(cell));
  assert.equal(new Set(arrayAddresses.map(cellKey)).size, matrixCells.length,
    "distinct MATRIX occurrences never collapse onto one ARRAY address");
  assert.equal(new Set(arrayAddresses.map(identityKey)).size, matrixCells.length,
    "the reverse address map preserves each repeated entry identity");
  for (const cell of matrixCells) {
    const roundTrip = addresses.toMatrix(addresses.toArray(cell));
    assert.deepEqual(roundTrip, cell, `MATRIX occurrence ${identityKey(cell)} maps back without a copy jump`);
  }

  const residentMatrixAddresses = new Set();
  for (const [foobarEntryKey, slot] of catalog) {
    const arrayCell = { lane: slot.lane, row: slot.row, foobarEntryKey };
    const matrixCell = addresses.toMatrix(arrayCell);
    const paired = poolByAddress.get(cellKey(matrixCell));
    assert.ok(paired, `canonical ${foobarEntryKey} has a real MATRIX occurrence`);
    assert.equal(paired.foobarEntryKey, foobarEntryKey, `canonical ${foobarEntryKey} keeps its identity`);
    assert.deepEqual(addresses.toArray(paired), arrayCell, `canonical ${foobarEntryKey} returns to its ARRAY slot`);
    assert.ok(!residentMatrixAddresses.has(cellKey(matrixCell)), "canonical residents have one-to-one MATRIX endpoints");
    residentMatrixAddresses.add(cellKey(matrixCell));
  }
  assert.equal(residentMatrixAddresses.size, catalog.size, "every valid ARRAY entry has exactly one paired MATRIX cell");

  const physicalRowsByLane = new Map();
  for (const cell of matrixCells) {
    const rows = physicalRowsByLane.get(cell.lane) ?? [];
    rows.push(cell.row);
    physicalRowsByLane.set(cell.lane, rows);
  }
  for (let lane = 0; lane < columnLengths.length; lane++) {
    const offset = addresses.rowOffsets.get(lane);
    const period = columnLengths[lane];
    assert.ok(Number.isInteger(offset), `ARRAY column ${lane} has a frozen integer row offset`);
    assert.equal(mod(offset, period), 0, `ARRAY column ${lane} keeps one complete ${period}-entry cycle`);
    const matrixLane = lane + addresses.laneOffset;
    const poolRows = physicalRowsByLane.get(matrixLane);
    assert.ok(poolRows, `ARRAY column ${lane} maps to physical MATRIX lane ${matrixLane}`);
    const firstPoolRow = Math.min(...poolRows), lastPoolRow = Math.max(...poolRows);
    const slots = [...catalog.entries()].filter(([, slot]) => slot.lane === lane)
      .map(([foobarEntryKey, slot]) => ({ ...slot, foobarEntryKey }));
    const mappedRows = slots.map(slot => slot.row + offset);
    assert.ok(Math.min(...mappedRows) >= firstPoolRow + 1 && Math.max(...mappedRows) <= lastPoolRow - 1,
      `column ${lane} maps its entire canonical cycle inside the MATRIX window with a row buffer`);
    for (const slot of slots) {
      const matrixCell = { lane: matrixLane, row: slot.row + offset, foobarEntryKey: slot.foobarEntryKey };
      assert.deepEqual(poolByAddress.get(cellKey(matrixCell)), matrixCell,
        `${slot.foobarEntryKey} occupies its complete-cycle MATRIX endpoint`);
    }
  }
  for (const [lane, offset] of Object.entries(expectedOffsets))
    assert.equal(addresses.rowOffsets.get(Number(lane)), offset, `column ${lane} uses the expected rail phase`);

  const selectedM = poolByAddress.get(cellKey(matrixSelection));
  assert.equal(selectedM?.foobarEntryKey, arraySelection.foobarEntryKey,
    "the selected ARRAY identity exists at the distant MATRIX selection address");
  return { addresses, matrixCells, matrixSelection, arraySelection };
}

for (const scenario of [
  { name: "45 entries [20,20,5], selected in short column", lengths: [20, 20, 5], order: 42, phases: [10, -10] },
  { name: "39 entries [20,19], canonical row 31 at MATRIX row ± far phase", lengths: [20, 19], order: 19, phases: [9, -9] },
  { name: "38 entries [20,18], distant selection in both directions", lengths: [20, 18], order: 1, phases: [9, -9] },
]) {
  test(`${scenario.name}: complete addresses round-trip without holes or identity loss`, () => {
    for (const cycles of scenario.phases) {
      const value = fixture(scenario.lengths, scenario.order, cycles);
      const expectedOffsets = scenario.lengths[0] === 20 && scenario.lengths[1] === 19
        ? { 1: cycles > 0 ? 190 : -171 } : {};
      const result = checkFixture(value, expectedOffsets);
      if (scenario.lengths[0] === 20 && scenario.lengths[1] === 19) {
        assert.equal(result.matrixSelection.row, cycles > 0 ? 211 : -149,
          "the 20/19 fixture exercises the row-31 to row-211/-149 selection phase");
      }
    }
  });
}
