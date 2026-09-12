/**
 * The map — where the work went, and when.
 *
 * A list answers "what is to be done". This answers what no list does: *we
 * have spent three weeks in infra and have not touched engine.* Angle is the
 * area, radius is time — the centre is the first card, the rim is now.
 *
 * SVG, not Canvas and not 3D. Two reasons, and the second is the one that
 * matters:
 *
 *   SVG stays sharp at any zoom, is keyboard-reachable, and every dot carries
 *   a real label. A picture a screen reader cannot read is a picture half the
 *   point of which is missing.
 *
 *   A THIRD DIMENSION MUST CARRY A THIRD VARIABLE. Angle is the area, radius
 *   is time — and we measure nothing that would honestly be depth. 3D without
 *   a third variable is a toy, and it costs hover precision, keyboard access
 *   and readability.
 *
 * What this version fixes, all of it found by looking at the real board:
 * labels ran off the edge; every dot was the same grey because open and done
 * looked alike; the rings said nothing; and a sector with one card looked as
 * important as one with twenty.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chosenLanguage, words } from './words';
import { ageOf, shortAge } from './age';

const t = words(chosenLanguage());
import type { Card } from './api';

const SIZE = 760;
const CENTRE = SIZE / 2;
const INNER = 60;
const OUTER = 268;

type Dot = { card: Card; x: number; y: number; area: string; angle: number };

/**
 * The axis a card sits on: the AREA of its first module — the coarse axis the
 * vocabulary carries (an app, or the packages) — else the module itself, else
 * its craft. Thirty-six slices of a circle are a clock nobody can read; six
 * are a map.
 */
const areaOf = (card: Card, areaOfModule: Record<string, string> = {}) => {
  const module = card.module[0];
  if (module) return areaOfModule[module] ?? module;
  return card.stack[0] ?? 'unlabelled';
};
const OPEN = (card: Card) => !['done', 'ice'].includes(card.state);
const when = (card: Card) => new Date(card.created ?? Date.now()).getTime();

const day = (ms: number) => new Date(ms).toISOString().slice(5, 10).replace('-', '.');

/**
 * NOT called `Map`: the built-in `Map` is in use in the same file, and a
 * component that hides its own toolbox is a mistake noticed only on the
 * second use.
 */
export default function AreaMap({ cards, open, areaOfModule = {} }: { cards: Card[]; open: (key: string) => void; areaOfModule?: Record<string, string> }) {
  const [hover, setHover] = useState<Dot | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!hover || !tooltip.current) return;
    const box = tooltip.current.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(anchor.x + 14, window.innerWidth - box.width - 8)), y: Math.max(8, anchor.y + 14 + box.height < window.innerHeight ? anchor.y + 14 : anchor.y - box.height - 14) });
  }, [hover, anchor]);
  const [only, setOnly] = useState<string | null>(null);
  const [onlyState, setOnlyState] = useState<string | null>(null);

  const { dots, areas, first, last } = useMemo(() => {
    const counted = new Map<string, number>();
    for (const card of cards) counted.set(areaOf(card, areaOfModule), (counted.get(areaOf(card, areaOfModule)) ?? 0) + 1);
    // Busiest area first, going clockwise from the top: the eye starts at the
    // top and the first thing it should learn is where the weight sits.
    const order = [...counted.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);

    const times = cards.map(when);
    const from = Math.min(...times);
    const to = Math.max(...times, from + 1);

    const perArea = new Map<string, number>();
    const placed: Dot[] = cards.map((card) => {
      const area = areaOf(card, areaOfModule);
      const slot = order.indexOf(area);
      const seen = (perArea.get(area) ?? 0) + 1;
      perArea.set(area, seen);
      // Fan out inside the sector so two cards from the same hour are two dots,
      // not one. Deterministic, so the picture does not dance on every poll.
      const width = (Math.PI * 2) / order.length;
      const spread = ((seen % 7) - 3) * (width / 16);
      const angle = (slot + 0.5) * width + spread - Math.PI / 2;
      const age = (when(card) - from) / Math.max(1, to - from);
      const radius = INNER + age * (OUTER - INNER);
      return { card, area, angle, x: CENTRE + Math.cos(angle) * radius, y: CENTRE + Math.sin(angle) * radius };
    });

    return { dots: placed, areas: order, first: from, last: to };
  }, [cards, areaOfModule]);

  if (!cards.length) return <p className="empty">{t('map.empty')}</p>;

  // Two filters, and they narrow together: an area AND a state is the question
  // "what is still open in gpu", which is the one people actually ask.
  const shown = dots.filter((d) => (!only || d.area === only) && (!onlyState || d.card.state === onlyState));
  const pale = new Set(shown.map((d) => d.card.key));

  return (
    <div className="map-face">
      <div className="map-plot"><svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group"
        aria-label={`${cards.length} ${t('map.cards')}, ${areas.length} ${t('map.areas')} — ${t('map.how')}`}>
        {/* The rings say when. Without a label a ring is decoration. */}
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <circle cx={CENTRE} cy={CENTRE} r={INNER + r * (OUTER - INNER)} className="map-ring" />
            <text x={CENTRE + 4} y={CENTRE - (INNER + r * (OUTER - INNER)) - 5} className="map-time">
              {day(first + r * (last - first))}
            </text>
          </g>
        ))}

        {areas.map((name, i) => {
          const width = (Math.PI * 2) / areas.length;
          const edge = (i) * width - Math.PI / 2;
          const mid = (i + 0.5) * width - Math.PI / 2;
          const lx = CENTRE + Math.cos(mid) * (OUTER + 46);
          const ly = CENTRE + Math.sin(mid) * (OUTER + 46);
          const count = dots.filter((d) => d.area === name).length;
          const dim = only && only !== name;
          return (
            <g key={name} className={dim ? 'map-sector-pale' : undefined}>
              <line x1={CENTRE + Math.cos(edge) * INNER} y1={CENTRE + Math.sin(edge) * INNER}
                x2={CENTRE + Math.cos(edge) * OUTER} y2={CENTRE + Math.sin(edge) * OUTER}
                className="map-spoke" />
              <text x={lx} y={ly} className="map-sector" textAnchor="middle"
                role="button" tabIndex={0} aria-label={name}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOnly(only === name ? null : name); } }}
                onClick={() => setOnly(only === name ? null : name)}>
                {name}
                <tspan className="map-sector-number" dy="14" x={lx}>{count}</tspan>
              </text>
            </g>
          );
        })}

        {dots.map((dot) => (
          <circle
            key={dot.card.key}
            cx={dot.x} cy={dot.y}
            r={dot.card.kind === 'milestone' ? 8 : OPEN(dot.card) ? 6 : 4}
            className={`${DOT_CLASS[dot.card.state] ?? 'dot'}${pale.has(dot.card.key) ? '' : ' map-pale'}`}
            tabIndex={0}
            role="button"
            aria-label={`${dot.card.key} ${dot.card.title}, ${dot.area}, ${dot.card.state}`}
            aria-describedby={hover?.card.key === dot.card.key ? "map-tooltip" : undefined}
            onMouseEnter={(e) => { setAnchor({ x: e.clientX, y: e.clientY }); setHover(dot); }}
            onMouseMove={(e) => setAnchor({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
            onFocus={(e) => { const box = e.currentTarget.getBoundingClientRect(); setAnchor({ x: box.right, y: box.top }); setHover(dot); }}
            onBlur={() => setHover(null)}
            onClick={() => open(dot.card.key)}
            onKeyDown={(e) => { if (e.key === 'Escape') setHover(null); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(dot.card.key); } }}
          />
        ))}
      </svg></div>

      <div className="map-foot">
        <select aria-label={t('ui.area')} value={only ?? ''} onChange={(e) => setOnly(e.target.value || null)}>
          <option value="">{t('nav.allAreas')}</option>
          {areas.map((area) => <option key={area} value={area}>{area}</option>)}
        </select>
        <div className="map-hint">
          <span className="small">{t('map.how')}</span>
        </div>
        <div ref={tooltip} id="map-tooltip" role="tooltip" className="map-tooltip" hidden={!hover} style={{ left: position.x, top: position.y }}>
          {hover ? (
            <>
              <b>{hover.card.key}</b> {hover.card.title}
              <span className="small">
                {[
                  hover.area,
                  t(hover.card.state),
                  ...(hover.card.module.length ? [hover.card.module.join(' ')] : []),
                  ...(hover.card.stack.length ? [hover.card.stack.join(' ')] : []),
                  ...(hover.card.person ? [hover.card.person] : []),
                  ...(hover.card.gate ? [t('card.gate')] : []),
                  ...(hover.card.blockedBy.length ? [`${t('card.waits')} ${hover.card.blockedBy.join(' ')}`] : []),
                  `${t('map.born')} ${day(when(hover.card))}`,
                  ...(ageOf(hover.card).idle ? [`${shortAge(ageOf(hover.card).days)} ${t('map.untouched')}`] : []),
                ].join(' · ')}
              </span>
            </>
          ) : null}
        </div>
        {/*
          * The legend IS the filter. A legend that only explains is a legend
          * you read once; one you can press is the way you ask "show me what
          * is in review" — and the question was already on the screen.
          */}
        <ul className="map-legend">
          {LEGEND.map((state) => (
            <li key={state}>
              <button
                className={onlyState === state ? 'map-key here' : 'map-key'}
                aria-pressed={onlyState === state}
                onClick={() => setOnlyState(onlyState === state ? null : state)}
              >
                <span className={DOT_CLASS[state]} /> {t(state)}
                <span className="map-key-number">{dots.filter((d) => d.card.state === state).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <select aria-label={t('nav.search')} value="" onChange={(e) => { if (e.target.value) open(e.target.value); }}>
          <option value="">{t('nav.search')}</option>
          {shown.map(({ card }) => <option key={card.key} value={card.key}>{card.key} · {card.title}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Written out, so the surface test can find every one — see tests/surface.test.mjs. */
const DOT_CLASS: Record<string, string> = {
  ideas: 'dot dot-ideas',
  ready: 'dot dot-ready',
  making: 'dot dot-making',
  review: 'dot dot-review',
  done: 'dot dot-done',
  ice: 'dot dot-ice',
};

/** The states, in the order a card climbs them. The words come from the spec. */
const LEGEND = ['ideas', 'ready', 'making', 'review', 'done', 'ice'];
