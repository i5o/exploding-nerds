// Exploding Nerds rules engine and computer players.
// No DOM in here, so the same file runs in the app and under `node test.js`.
'use strict';

const Engine = (() => {
  // key: [name, first image number, count]. A card's id is its image number (cards/cNN.webp).
  const TYPES = {
    exploding: ['Exploding Nerd', 1, 4],
    defuse: ['Defuse', 5, 6],
    attack: ['Attack', 11, 4],
    targeted: ['Targeted Attack', 15, 3],
    favor: ['Favor', 18, 4],
    nope: ['Nope', 22, 5],
    shuffle: ['Shuffle', 27, 4],
    skip: ['Skip', 31, 4],
    future: ['See the Future', 35, 6],
    reverse: ['Reverse', 41, 4],
    bottom: ['Draw from the Bottom', 45, 4],
    alter: ['Alter the Future', 49, 5],
    curse: ['Curse of the Code', 54, 2],
    swap: ['Swap Top and Bottom', 56, 3],
    brain: ['Brain Fuel', 59, 4],
    sticker: ['Sticker Fan', 63, 4],
    keyboard: ['Noisy Keyboard', 67, 4],
    duck: ['Rubber Duck', 71, 4],
    legacy: ['Legacy Code', 75, 4],
  };
  const TYPE_OF = [];
  for (const [t, [, first, n]] of Object.entries(TYPES)) for (let i = 0; i < n; i++) TYPE_OF[first + i] = t;
  const typeOf = id => TYPE_OF[id];
  const nameOf = id => TYPES[typeOf(id)][0];
  const NERDS = ['brain', 'sticker', 'keyboard', 'duck', 'legacy'];
  const ACTIONS = ['attack', 'targeted', 'favor', 'shuffle', 'skip', 'future', 'reverse', 'bottom', 'alter', 'curse', 'swap'];

  const rand = n => Math.floor(Math.random() * n);
  const chance = p => Math.random() < p;
  const take = (arr, id) => arr.splice(arr.indexOf(id), 1)[0];
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Setup steps 1-5 from the rule sheet. pile[0] is the top of the Draw Pile.
  function newGame(names, fast = false) {
    const n = names.length;
    const ids = Array.from({ length: 78 }, (_, i) => i + 1);
    const nerds = ids.filter(id => typeOf(id) === 'exploding');
    const defuses = shuffle(ids.filter(id => typeOf(id) === 'defuse'));
    const pile = ids.filter(id => !['exploding', 'defuse'].includes(typeOf(id)));
    const players = names.map(name => ({ name, hand: [defuses.pop()], alive: true, blind: false, known: null, exploded: null }));
    pile.push(...defuses.splice(0, n === 5 ? 1 : 2));
    shuffle(pile);
    for (const p of players) p.hand.push(...pile.splice(0, 7));
    const removed = [...defuses];
    if (fast) removed.push(...pile.splice(0, Math.floor(pile.length / 3)));
    pile.push(...nerds.slice(0, n - 1));
    removed.push(...nerds.slice(n - 1));
    shuffle(pile);
    // turns: turns left for the current player. attacked: those turns came from an Attack.
    // v: bumped whenever the pile order changes other than by drawing, which voids what anyone saw.
    return { players, pile, discard: [], removed, cur: rand(n), dir: 1, turns: 1, attacked: false, v: 0, winner: null };
  }

  const alive = g => g.players.filter(p => p.alive);
  const seat = (g, i, k) => {
    const n = g.players.length;
    return (((i + k * g.dir) % n) + n) % n;
  };
  function nextAlive(g, i) {
    for (let k = 1; k <= g.players.length; k++) {
      const j = seat(g, i, k);
      if (g.players[j].alive) return j;
    }
  }
  // There is always one Exploding Nerd fewer than live players in the pile, so this is public info.
  const risk = g => (alive(g).length - 1) / g.pile.length;

  // Top cards this player has seen and that are still valid, top first.
  function knownTop(g, p) {
    return p.known && p.known.v === g.v ? p.known.ids.filter(id => g.pile.includes(id)) : [];
  }

  function playKind(cards) {
    const ts = cards.map(typeOf);
    if (cards.length === 1 && ACTIONS.includes(ts[0])) return ts[0];
    if ((cards.length === 2 || cards.length === 3) && NERDS.includes(ts[0]) && ts.every(t => t === ts[0])) {
      return cards.length === 2 ? 'pair' : 'triple';
    }
    return null;
  }

  // Players this kind of play may target, or null if it takes no target.
  function targets(g, pi, kind) {
    const live = g.players.map((_, i) => i).filter(i => g.players[i].alive);
    if (kind === 'targeted') return live;
    if (kind === 'curse') return live.filter(i => i !== pi);
    if (['favor', 'pair', 'triple'].includes(kind)) return live.filter(i => i !== pi && g.players[i].hand.length);
    return null;
  }

  function canPlay(g, pi, cards) {
    const hand = g.players[pi].hand;
    if (!cards.length || new Set(cards).size !== cards.length || !cards.every(id => hand.includes(id))) return false;
    const kind = playKind(cards);
    const opts = kind && targets(g, pi, kind);
    return !!kind && (opts === null || opts.length > 0);
  }

  function victimOf(g, a) {
    if (a.kind === 'attack') return nextAlive(g, a.p);
    return ['targeted', 'favor', 'pair', 'triple', 'curse'].includes(a.kind) ? a.target : null;
  }

  // io.decide(playerIndex, kind, ctx) -> answer; io.event(type, data) for the UI. Both may be async.
  async function run(g, io) {
    while (alive(g).length > 1) await turn(g, io);
    g.winner = g.players.findIndex(p => p.alive);
    await io.event('win', { p: g.winner });
  }

  async function turn(g, io) {
    const pi = g.cur;
    await io.event('turn', { p: pi, turns: g.turns });
    for (;;) {
      const move = await io.decide(pi, 'move', {});
      if (!move) break;
      if (await play(g, io, pi, move)) return; // the card ended the turn
    }
    await draw(g, io, pi, 'top');
    endTurn(g);
  }

  function endTurn(g) {
    if (g.players[g.cur].alive && --g.turns > 0) return;
    g.cur = nextAlive(g, g.cur);
    g.turns = 1;
    g.attacked = false;
  }

  // move: { cards, target?, named? } or { blind: true } for a cursed player flipping a random card.
  // Returns true when the play ended the turn.
  async function play(g, io, pi, move) {
    const p = g.players[pi];
    let cards = move.cards || [];
    if (move.blind) {
      if (!p.hand.length) throw new Error(`${p.name} has nothing to flip`);
      cards = [p.hand[rand(p.hand.length)]];
      if (!canPlay(g, pi, cards)) {
        g.discard.push(take(p.hand, cards[0]));
        await io.event('lost', { p: pi, id: cards[0] });
        return false;
      }
    } else if (!canPlay(g, pi, cards)) {
      throw new Error(`illegal play by ${p.name}: ${cards}`);
    }
    const kind = playKind(cards);
    const options = targets(g, pi, kind);
    let { target, named } = move;
    if (options && !options.includes(target)) {
      target = await io.decide(pi, 'target', { kind, options, cancelable: !move.blind });
      if (target == null && !move.blind) return false; // backed out, cards stay in hand
      if (!options.includes(target)) throw new Error(`bad target from ${p.name}`);
    }
    if (kind === 'triple' && !TYPES[named]) {
      named = await io.decide(pi, 'name', { cancelable: true });
      if (named == null) return false;
      if (!TYPES[named]) throw new Error(`bad card name from ${p.name}`);
    }
    for (const id of cards) g.discard.push(take(p.hand, id));
    const act = { p: pi, kind, cards, target, named };
    await io.event('play', act);
    if (!(await nopes(g, io, act))) return false;
    return effect(g, io, act);
  }

  // Everyone holding a Nope gets the window at once and the first yes plays it; a Nope on a Nope
  // turns the action back on. Returns whether the action happens.
  // ponytail: blind (cursed) players can't Nope since they can't see their hand.
  async function nopes(g, io, act) {
    let on = true;
    let last = act.p;
    for (;;) {
      const ctx = { act, on };
      const eligible = g.players
        .map((q, i) => i)
        .filter(i => i !== last && g.players[i].alive && !g.players[i].blind && g.players[i].hand.some(id => typeOf(id) === 'nope'));
      const who = await firstYes(eligible, i => io.decide(i, 'nope', ctx));
      if (who === null) return on;
      const q = g.players[who];
      g.discard.push(take(q.hand, q.hand.find(id => typeOf(id) === 'nope')));
      on = !on;
      last = who;
      await io.event('nope', { p: who, act, on });
    }
  }

  // Asks everyone in parallel; resolves with the first one to say yes, or null once all said no.
  function firstYes(seats, ask) {
    return new Promise((resolve, reject) => {
      let left = seats.length;
      if (!left) resolve(null);
      for (const i of seats) Promise.resolve(ask(i)).then(yes => (yes ? resolve(i) : --left || resolve(null)), reject);
    });
  }

  async function effect(g, io, a) {
    const p = g.players[a.p];
    const t = g.players[a.target];
    switch (a.kind) {
      case 'attack':
      case 'targeted':
        // A victim who attacks passes on their remaining turns plus 2.
        g.turns = g.attacked ? g.turns + 2 : 2;
        g.attacked = true;
        g.cur = a.kind === 'attack' ? nextAlive(g, a.p) : a.target;
        await io.event('attacked', { p: g.cur, turns: g.turns });
        return true;
      case 'skip':
        endTurn(g);
        return true;
      case 'reverse':
        g.dir = -g.dir;
        endTurn(g);
        return true;
      case 'bottom':
        await draw(g, io, a.p, 'bottom');
        endTurn(g);
        return true;
      case 'shuffle':
        shuffle(g.pile);
        g.v++;
        await io.event('shuffled', { p: a.p });
        return false;
      case 'swap': {
        const last = g.pile.length - 1;
        [g.pile[0], g.pile[last]] = [g.pile[last], g.pile[0]];
        g.v++;
        return false;
      }
      case 'future':
        p.known = { v: g.v, ids: g.pile.slice(0, 3) };
        await io.decide(a.p, 'future', { cards: p.known.ids });
        return false;
      case 'alter': {
        const top = g.pile.slice(0, 3);
        const order = await io.decide(a.p, 'alter', { cards: top });
        if (!order || order.length !== top.length || !top.every(id => order.includes(id))) throw new Error('alter must reorder the same cards');
        g.pile.splice(0, top.length, ...order);
        g.v++;
        p.known = { v: g.v, ids: order };
        return false;
      }
      case 'favor': {
        if (!t.hand.length) return false;
        let id = await io.decide(a.target, 'favor', { to: a.p });
        if (!t.hand.includes(id)) id = t.hand[0];
        p.hand.push(take(t.hand, id));
        await io.event('gave', { from: a.target, to: a.p, id });
        return false;
      }
      case 'pair': {
        if (!t.hand.length) return false;
        const id = t.hand[rand(t.hand.length)];
        p.hand.push(take(t.hand, id));
        await io.event('stole', { from: a.target, to: a.p, id });
        return false;
      }
      case 'triple': {
        const id = t.hand.find(c => typeOf(c) === a.named);
        if (id) p.hand.push(take(t.hand, id));
        await io.event('named', { from: a.target, to: a.p, named: a.named, id });
        return false;
      }
      case 'curse':
        t.blind = true;
        shuffle(t.hand);
        await io.event('cursed', { p: a.target });
        return false;
    }
    throw new Error(`unknown play ${a.kind}`);
  }

  async function draw(g, io, pi, from) {
    const p = g.players[pi];
    if (!g.pile.length) throw new Error('draw pile is empty');
    const id = from === 'top' ? g.pile.shift() : g.pile.pop();
    if (typeOf(id) !== 'exploding') {
      p.hand.push(id);
      p.blind = false;
      await io.event('draw', { p: pi, id, from });
      return;
    }
    p.exploded = id; // face up in front of the player until it's defused
    await io.event('exploding', { p: pi, id });
    let defuse;
    if (p.blind) {
      // A cursed player flips random cards until a Defuse turns up, or runs out.
      shuffle(p.hand);
      while (p.hand.length && !defuse) {
        const c = p.hand.pop();
        g.discard.push(c);
        if (typeOf(c) === 'defuse') defuse = c;
        else await io.event('lost', { p: pi, id: c });
      }
    } else {
      defuse = p.hand.find(c => typeOf(c) === 'defuse');
      if (defuse) g.discard.push(take(p.hand, defuse));
    }
    if (!defuse) {
      p.alive = false;
      p.blind = false;
      g.removed.push(...p.hand);
      p.hand = [];
      await io.event('boom', { p: pi, id });
      return;
    }
    p.blind = false;
    await io.event('defused', { p: pi, id: defuse });
    const known = knownTop(g, p);
    let pos = Math.round(await io.decide(pi, 'defuse', { size: g.pile.length })) || 0;
    pos = Math.max(0, Math.min(g.pile.length, pos));
    p.exploded = null;
    g.pile.splice(pos, 0, id);
    g.v++;
    p.known = { v: g.v, ids: pos <= known.length ? [...known.slice(0, pos), id, ...known.slice(pos)] : known };
    await io.event('reinserted', { p: pi, pos });
  }

  // ---- per-player views, so a networked player only ever receives what they may see ----

  function view(g, seat) {
    const me = g.players[seat];
    return {
      you: seat,
      players: g.players.map(p => ({ name: p.name, alive: p.alive, blind: p.blind, exploded: p.exploded, count: p.hand.length })),
      hand: [...me.hand],
      pile: g.pile.length,
      discard: g.discard.length ? g.discard[g.discard.length - 1] : null,
      cur: g.cur,
      turns: g.turns,
      dir: g.dir,
      winner: g.winner,
      known: me.alive ? knownTop(g, me) : [],
    };
  }

  // Drops the card id / position from events this seat shouldn't see the details of.
  function redact(type, d, seat) {
    const own = type === 'draw' || type === 'reinserted' ? d.p === seat : type === 'gave' || type === 'stole' ? d.from === seat || d.to === seat : true;
    if (own) return d;
    const { id, pos, ...rest } = d;
    return rest;
  }

  // Answers from the network are untrusted: coerce them into something legal.
  function sanitize(g, pi, kind, ctx, v) {
    const p = g.players[pi];
    switch (kind) {
      case 'move':
        if (p.blind) return v && v.blind && p.hand.length ? { blind: true } : null;
        return v && Array.isArray(v.cards) && canPlay(g, pi, v.cards) ? { cards: v.cards } : null;
      case 'target':
        return ctx.options.includes(v) ? v : ctx.cancelable ? null : ctx.options[0];
      case 'name':
        return typeof v === 'string' && Object.hasOwn(TYPES, v) ? v : null; // not '__proto__' and friends
      case 'nope':
        return v === true;
      case 'alter':
        return Array.isArray(v) && v.length === ctx.cards.length && ctx.cards.every(id => v.includes(id)) ? v : ctx.cards;
      default:
        return v; // favor and defuse are already range-checked by the engine
    }
  }

  // ---- computer players: only look at their own hand, public counts and what they've seen ----

  const VALUE = { defuse: 10, nope: 7, attack: 6, targeted: 6, skip: 5, alter: 5, future: 4, favor: 4, curse: 4, shuffle: 3, reverse: 3, bottom: 3, swap: 2 };
  const worth = id => VALUE[typeOf(id)] || 1;

  function bot(g, pi, kind, ctx) {
    const p = g.players[pi];
    const size = i => g.players[i].hand.length;
    switch (kind) {
      case 'move':
        return botMove(g, pi);
      case 'target': {
        const opts = ctx.options.filter(i => i !== pi);
        if (!opts.length) return ctx.options[0];
        if (ctx.kind === 'curse') return opts[rand(opts.length)];
        // Attack whoever holds the fewest cards; rob whoever holds the most.
        return opts.reduce((a, b) => ((ctx.kind === 'targeted' ? size(b) < size(a) : size(b) > size(a)) ? b : a));
      }
      case 'name':
        return 'defuse';
      case 'nope': {
        const { act, on } = ctx;
        if (act.p === pi) return !on && chance(0.6);
        if (!on) return false;
        if (victimOf(g, act) === pi) return chance(['attack', 'targeted', 'triple'].includes(act.kind) ? 0.7 : 0.45);
        return chance(0.03);
      }
      case 'favor':
        return p.hand.reduce((a, b) => (worth(b) < worth(a) ? b : a));
      case 'defuse': {
        const n = ctx.size;
        if (g.cur === pi && g.turns > 1) return n - rand(Math.ceil(n / 2)); // drawing again soon: bury it
        return chance(0.5) ? 0 : rand(n + 1);
      }
      case 'alter':
        return [...ctx.cards].sort((a, b) => (typeOf(a) === 'exploding') - (typeOf(b) === 'exploding'));
      default:
        return undefined; // 'future': nothing to answer, the engine records what was seen
    }
  }

  // ponytail: fixed-probability heuristics; swap in a smarter bot if games feel too easy.
  function botMove(g, pi) {
    const p = g.players[pi];
    const hand = p.hand;
    if (p.blind) return hand.length && chance(0.25) ? { blind: true } : null;
    const one = t => {
      const id = hand.find(c => typeOf(c) === t);
      return id && canPlay(g, pi, [id]) ? { cards: [id] } : null;
    };
    const known = knownTop(g, p);
    if (known.length && typeOf(known[0]) === 'exploding') {
      return one('attack') || one('targeted') || one('skip') || one('reverse') || one('alter') || one('shuffle') || one('swap') || one('bottom');
    }
    if (chance(0.4)) {
      for (const t of NERDS) {
        const ids = hand.filter(c => typeOf(c) === t);
        if (ids.length >= 3 && canPlay(g, pi, ids.slice(0, 3))) return { cards: ids.slice(0, 3), named: 'defuse' };
        if (ids.length === 2 && canPlay(g, pi, ids)) return { cards: ids };
      }
    }
    const r = risk(g);
    if (!known.length && r > 0.12) {
      const m = one('future') || one('alter');
      if (m) return m;
    }
    if (chance(0.2)) {
      const m = one('favor') || one('curse');
      if (m) return m;
    }
    if (!known.length && (r > 0.3 || (r > 0.15 && !hand.some(c => typeOf(c) === 'defuse')))) {
      const m = (chance(0.6) && one('attack')) || one('skip') || one('targeted') || one('reverse') || one('shuffle') || one('bottom');
      if (m) return m;
    }
    return null;
  }

  return { TYPES, typeOf, nameOf, newGame, alive, nextAlive, playKind, canPlay, run, effect, endTurn, bot, view, redact, sanitize };
})();

if (typeof module !== 'undefined') module.exports = Engine;
