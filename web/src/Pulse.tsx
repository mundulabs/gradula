/**
 * The pulse — five questions, one screen.
 *
 *   what happened      the period, in cards, not in numbers
 *   where we are going the goals, nearest date first
 *   are we in time     the measured pace against the time left
 *   where energy went  module, craft, person
 *   what it hangs on   the cards the most other cards wait on
 *
 * THE SIXTH PANEL IS THE HONEST ONE. `nowhere` says how much of the energy
 * carries no label at all. Without it this screen would draw a confident
 * picture of the third of the work it happens to know about — which is the
 * failure mode of every dashboard that has ever been quietly switched off.
 *
 * NO SCORE ANYWHERE, and no percentage of likelihood. A bar shows a share of
 * what was measured; a verdict shows a word and the two numbers it rests on.
 * Whoever wants to disagree with it can see what to disagree with.
 */
import { useEffect, useState } from 'react';
import { pulse as readPulse } from './api';
import type { Pulse as Beat } from './api';
import { chosenLanguage, words } from './words';

const t = words(chosenLanguage());

/** A word for each verdict — the only place the surface names them. */
const VERDICT: Record<string, string> = {
  ahead: 'pulse.ahead', tight: 'pulse.tight', behind: 'pulse.behind',
  'no date': 'pulse.noDate', 'no pace': 'pulse.noPace', 'no parts': 'pulse.noParts',
  settled: 'pulse.settled',
};

/**
 * Colour means state, never decoration — the same law as the board. Only
 * `behind` is warm, because only `behind` is a thing to act on.
 */
const VERDICT_CLASS: Record<string, string> = {
  ahead: 'verdict ahead', tight: 'verdict tight', behind: 'verdict behind',
};

const day = (iso: string) => String(iso).slice(0, 10);

function Bars({ flow, nowhere, label }: { flow: Beat['energy']['module']; nowhere: { moves: number }; label: string }) {
  const most = Math.max(...flow.map((f) => f.moves), nowhere.moves, 1);
  return (
    <div className="flow">
      <h4>{label}</h4>
      {flow.length ? flow.slice(0, 8).map((f) => (
        <div className="bar" key={f.id} title={f.cards.join(' ')}>
          <span className="bar-name">{f.id}</span>
          <span className="bar-rail"><span className="bar-fill" style={{ width: `${(f.moves / most) * 100}%` }} /></span>
          <span className="bar-number">{f.moves}</span>
        </div>
      )) : <p className="quiet">{t('pulse.noLabels')}</p>}
      {nowhere.moves ? (
        <div className="bar nowhere" title={t('pulse.nowhereWhy')}>
          <span className="bar-name">{t('pulse.nowhere')}</span>
          <span className="bar-rail"><span className="bar-fill" style={{ width: `${(nowhere.moves / most) * 100}%` }} /></span>
          <span className="bar-number">{nowhere.moves}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function PulseView({ project, open }: { project: string; open: (key: string) => void }) {
  const [beat, setBeat] = useState<Beat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true; let reading = false; setBeat(null); setError(null);
    const refresh = () => {
      if (reading) return;
      reading = true;
      readPulse(project)
        .then((got) => { if (alive) { setBeat(got); setError(null); } })
        .catch((e) => { if (alive) setError(String(e.message ?? e)); })
        .finally(() => { reading = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [project, retry]);

  if (error) return <div className="error" role="alert">{error} <button onClick={() => setRetry((n) => n + 1)}>{t('ui.retry')}</button></div>;
  if (!beat) return <p className="quiet pulse-wait" role="status">{t('ui.loading')}</p>;

  const key = (k: string) => (
    <button className="key" key={k} onClick={() => open(k)}>{k}</button>
  );

  return (
    <div className="pulse">
      <p className="period">{day(beat.since)} → {day(beat.until)}</p>

      <section className="panel">
        <h3>{t('pulse.happened')}</h3>
        <p className="quiet">{beat.happened.touched} {t('pulse.touched')}{beat.happened.actors.length ? ` · ${beat.happened.actors.join(', ')}` : ''}</p>
        {([['pulse.done', beat.happened.done], ['pulse.released', beat.happened.released],
           ['pulse.decided', beat.happened.decided], ['pulse.incidents', beat.happened.incidents],
           ['pulse.started', beat.happened.started]] as const).map(([name, list]) => (
          list.length ? (
            <p className="row" key={name}>
              <span className="row-name">{t(name)}</span>
              {list.map((r) => key(r.card))}
            </p>
          ) : null
        ))}
        {!beat.happened.touched ? <p className="quiet">{t('pulse.nothing')}</p> : null}
      </section>

      <section className="panel">
        <h3>{t('pulse.pace')}</h3>
        <p>
          <strong>{beat.pace.settled}</strong> {t('pulse.settledIn')} {beat.pace.days} {t('pulse.days')}
          {' · '}{beat.pace.perDay.toFixed(2)} {t('pulse.perDay')}
        </p>
        <p className="quiet">{beat.pace.sample} {t('pulse.sample')}</p>
      </section>

      <section className="panel wide">
        <h3>{t('pulse.goals')}</h3>
        {beat.goals.length ? beat.goals.map((g) => (
          <div className="goal" key={g.key}>
            <p className="goal-head">
              {key(g.key)} <span className="goal-title">{g.title}</span>
              <span className={VERDICT_CLASS[g.outlook.verdict] ?? 'verdict'}>{t(VERDICT[g.outlook.verdict] ?? g.outlook.verdict)}</span>
            </p>
            <p className="quiet">
              {g.share === null ? t('pulse.noParts') : `${Math.round(g.share * 100)} % · ${g.done + g.dropped}/${g.total}`}
              {g.due ? ` · ${g.due}` : ''}
              {g.outlook.daysNeeded !== undefined
                ? ` · ${g.outlook.daysNeeded}${t('pulse.daysOfWork')}, ${g.outlook.daysLeft}${t('pulse.daysLeft')}`
                : ''}
            </p>
            {g.open.length ? <p className="row">{g.open.map(key)}</p> : null}
          </div>
        )) : <p className="quiet">{t('pulse.noGoals')}</p>}
      </section>

      <section className="panel wide">
        <h3>{t('pulse.energy')}</h3>
        <div className="flows">
          <Bars flow={beat.energy.module} nowhere={beat.energy.nowhere.module} label={t('pulse.module')} />
          <Bars flow={beat.energy.stack} nowhere={beat.energy.nowhere.stack} label={t('pulse.craft')} />
          <Bars
            flow={beat.energy.people.map((p) => ({ id: p.person, moves: p.moves, cards: p.cards }))}
            nowhere={{ moves: 0 }}
            label={t('pulse.people')}
          />
        </div>
      </section>

      <section className="panel">
        <h3>{t('pulse.hangs')}</h3>
        {beat.hangs.length ? beat.hangs.map((h) => (
          <p className="row" key={h.card}>
            {key(h.card)} <span className="goal-title">{h.title}</span>
            <span className="quiet"> ← </span>
            {h.waiting.map(key)}
          </p>
        )) : <p className="quiet">{t('pulse.nothingHangs')}</p>}
      </section>

      <section className="panel">
        <h3>{t('pulse.board')}</h3>
        {beat.findings.length ? beat.findings.map((f) => (
          <p className="row" key={f.id} title={t(`finding.${f.id}.why`, f.why)}>
            <span className="row-number">{f.count}</span>
            <span className="row-name">{t(`finding.${f.id}`, f.line)}</span>
            {f.cards.slice(0, 8).map(key)}
            {f.cards.length > 8 ? <span className="quiet">…</span> : null}
          </p>
        )) : <p className="quiet">{t('pulse.boardClean')}</p>}
      </section>
    </div>
  );
}
