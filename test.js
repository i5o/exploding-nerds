// Rules checks plus thousands of bot-only games. Run: node test.js
const assert = require('assert');
const E = require('./game/engine.js');

const names = n => Array.from({ length: n }, (_, i) => `bot${i}`);
const quiet = g => ({ decide: async (pi, kind, ctx) => E.bot(g, pi, kind, ctx), event: async () => {} });

function allCards(g) {
  const ids = [...g.pile, ...g.discard, ...g.removed, ...g.players.flatMap(p => (p.exploded ? [...p.hand, p.exploded] : p.hand))];
  assert.deepStrictEqual([...ids].sort((a, b) => a - b), Array.from({ length: 78 }, (_, i) => i + 1), 'every card exactly once');
}

(async () => {
  // Setup: 8 cards each incl. a Defuse, one Exploding Nerd fewer than players, extra Defuses per the rules.
  for (let n = 2; n <= 5; n++) {
    const g = E.newGame(names(n));
    allCards(g);
    for (const p of g.players) {
      assert.strictEqual(p.hand.length, 8);
      assert(p.hand.some(id => E.typeOf(id) === 'defuse'));
    }
    assert.strictEqual(g.pile.filter(id => E.typeOf(id) === 'exploding').length, n - 1);
    assert.strictEqual(g.pile.length, 68 + (n === 5 ? 1 : 2) - 7 * n + n - 1);
  }

  // Attack stacking, straight from the Attack card's examples.
  {
    const g = E.newGame(names(4));
    const io = quiet(g);
    g.cur = 0;
    await E.effect(g, io, { p: 0, kind: 'attack' });
    assert.deepStrictEqual([g.cur, g.turns], [1, 2], 'attack: next player takes 2');
    await E.effect(g, io, { p: 1, kind: 'attack' });
    assert.deepStrictEqual([g.cur, g.turns], [2, 4], 'victim attacks right away: next takes 4');
    E.endTurn(g);
    E.endTurn(g);
    E.endTurn(g);
    await E.effect(g, io, { p: 2, kind: 'attack' });
    assert.deepStrictEqual([g.cur, g.turns], [3, 3], 'victim attacks on last turn: next takes 3');
    await E.effect(g, io, { p: 3, kind: 'targeted', target: 1 });
    assert.deepStrictEqual([g.cur, g.turns], [1, 5], 'targeted attack stacks the same way');
    E.endTurn(g);
    await E.effect(g, io, { p: 1, kind: 'skip' });
    assert.deepStrictEqual([g.cur, g.turns], [1, 3], 'skip ends only one of the turns');
  }

  // Reverse flips direction; with 2 players it's just a Skip.
  {
    const g = E.newGame(names(3));
    g.cur = 0;
    await E.effect(g, quiet(g), { p: 0, kind: 'reverse' });
    assert.deepStrictEqual([g.cur, g.dir], [2, -1]);
    const h = E.newGame(names(2));
    h.cur = 0;
    await E.effect(h, quiet(h), { p: 0, kind: 'reverse' });
    assert.strictEqual(h.cur, 1);
  }

  // Nope window is parallel: the fastest yes wins, then the other player can Yup.
  {
    const g = E.newGame(names(3));
    const SKIP = 31;
    g.players[0].hand = [SKIP];
    g.players[1].hand = [22];
    g.players[2].hand = [23];
    g.cur = 0;
    const order = [];
    const io = {
      decide: (pi, kind) => {
        if (kind === 'move') {
          if (pi === 0 && g.players[0].hand.length) return { cards: [SKIP] };
          throw new Error('stop');
        }
        return pi === 1 ? new Promise(r => setTimeout(() => r(true), 30)) : true;
      },
      event: (type, d) => type === 'nope' && order.push(d.p),
    };
    await E.run(g, io).catch(e => assert.strictEqual(e.message, 'stop'));
    assert.deepStrictEqual(order, [2, 1], 'fastest Nope wins, then the slower player Yups');
    assert.strictEqual(g.cur, 1, 'the Yup put the Skip back on');
  }

  // Views and redaction: other hands and private card details never leave the host.
  {
    const g = E.newGame(names(3));
    const v = E.view(g, 1);
    assert.deepStrictEqual(v.hand, g.players[1].hand);
    assert(!('hand' in v.players[0]) && v.players[0].count === 8);
    assert.strictEqual(E.redact('draw', { p: 0, id: 40 }, 1).id, undefined);
    assert.strictEqual(E.redact('draw', { p: 1, id: 40 }, 1).id, 40);
    assert.strictEqual(E.redact('stole', { from: 0, to: 2, id: 40 }, 1).id, undefined);
    assert.strictEqual(E.redact('gave', { from: 1, to: 2, id: 40 }, 1).id, 40);
    assert.strictEqual(E.redact('reinserted', { p: 0, pos: 0 }, 1).pos, undefined);
    assert.strictEqual(E.sanitize(g, 1, 'move', {}, { cards: g.players[0].hand.slice(0, 1) }), null, "can't play someone else's card");
    assert.strictEqual(E.sanitize(g, 1, 'target', { options: [0, 2], cancelable: false }, 7), 0);
    assert.strictEqual(E.sanitize(g, 1, 'nope', {}, 'yes'), false);
    assert.strictEqual(E.sanitize(g, 1, 'name', {}, '__proto__'), null, 'only real card types can be named');
    assert.strictEqual(E.sanitize(g, 1, 'name', {}, 'defuse'), 'defuse');
  }

  // Full games: cards are conserved after every event and exactly one player is left.
  const wins = {};
  for (let i = 0; i < 3000; i++) {
    const n = 2 + (i % 4);
    const g = E.newGame(names(n), i % 3 === 0);
    let events = 0;
    const io = {
      decide: async (pi, kind, ctx) => E.bot(g, pi, kind, ctx),
      event: async () => {
        allCards(g);
        assert(++events < 20000, 'game never ended');
      },
    };
    await E.run(g, io);
    assert.strictEqual(E.alive(g).length, 1);
    assert.strictEqual(g.players[g.winner].alive, true);
    wins[n] = (wins[n] || 0) + 1;
  }
  console.log('ok', wins);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
