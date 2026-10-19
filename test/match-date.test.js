const test=require('node:test');
const assert=require('node:assert/strict');
const {matchDate}=require('../src/services/matchDate');
test('match dates interpret SQLite timestamps as UTC and display the Brazilian date across midnight',()=>{
  assert.equal(matchDate('2026-10-18 01:30:00'),'17/10/2026 às 22:30 (Brasília)');
  assert.equal(matchDate('2026-10-18T01:30:00Z'),'17/10/2026 às 22:30 (Brasília)');
  assert.equal(matchDate('2026-10-17T22:30:00-03:00'),'17/10/2026 às 22:30 (Brasília)');
  assert.equal(matchDate(null),'Data não registrada');
  assert.equal(matchDate('invalid'),'Data não registrada');
});
