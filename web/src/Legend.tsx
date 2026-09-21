/**
 * The legend — what the board is saying.
 *
 * IT IS BUILT FROM THE LAWS, NOT WRITTEN OUT. Every signal here is drawn by
 * `beamFor`, the same call the cards make, and every state comes from the same
 * COLUMNS the board is built from. A legend maintained by hand is a legend
 * that is wrong by the second change — and a wrong legend is worse than none,
 * because it is believed.
 *
 * That is also why the shapes are shown and not described. "Needs a hand
 * breathes in orange" is a sentence about a thing; the thing itself is one
 * line of markup away and cannot drift.
 */
import Dialog from './Dialog';
import SignalFrame from './SignalFrame';
import { LEVEL_CLASS } from './motion';
import type { Signal } from './motion';
import { chosenLanguage, words } from './words';
import { KINDS } from './vocabulary';
import { QUIET_DAYS } from './age';

const t = words(chosenLanguage());

const SIGNALS: { signal: Signal; what: string; why: string }[] = [
  { signal: 'working', what: 'legend.working', why: 'legend.workingWhy' },
  { signal: 'attention', what: 'legend.attention', why: 'legend.attentionWhy' },
  { signal: 'changed', what: 'legend.changed', why: 'legend.changedWhy' },
];

function Sample({ signal, label }: { signal: Signal; label: string }) {
  const card = <span className="legend-card">{label}</span>;
  return <SignalFrame signal={signal}>{card}</SignalFrame>;
}

export default function Legend({ close }: { close: () => void }) {
  return (
    <Dialog title={t('legend.head')} close={close}>
      <div className="legend">
        <h3>{t('legend.signals')}</h3>
        <p className="quiet">{t('legend.oneWarm')}</p>
        {SIGNALS.map((row) => (
          <div className="legend-row" key={row.signal}>
            <Sample signal={row.signal} label={t(row.what)} />
            <span className="legend-why">{t(row.why)}</span>
          </div>
        ))}

        <h3>{t('legend.marks')}</h3>
        <div className="legend-row">
          <span className="legend-card"><span className="orb-dot" aria-hidden="true" /> {t('legend.orb')}</span>
          <span className="legend-why">{t('legend.orbWhy')}</span>
        </div>
        <div className="legend-row">
          <span className="legend-card"><span className="overdue">{t('card.overdue')}</span></span>
          <span className="legend-why">{t('card.overdueWhy')}</span>
        </div>
        <div className="legend-row">
          <span className="legend-card"><span className="idle">3w</span></span>
          <span className="legend-why">{t('card.idleWhy')} ({QUIET_DAYS} {t('pulse.days')})</span>
        </div>
        <div className="legend-row">
          <span className="legend-card"><span className="label module">module</span> <span className="label">craft</span> <span className="label guessed">guessed</span></span>
          <span className="legend-why">{t('legend.labelsWhy')}</span>
        </div>
        <div className="legend-row">
          <span className="legend-card"><span className="waiting">{t('card.waits')} APP-1</span></span>
          <span className="legend-why">{t('legend.waitsWhy')}</span>
        </div>
        <div className="legend-row">
          <span className="legend-card"><span className="done">{t('card.gate')}</span></span>
          <span className="legend-why">{t('legend.gateWhy')}</span>
        </div>

        <h3>{t('legend.levels')}</h3>
        <p className="quiet">{t('legend.levelsWhy')}</p>
        <div className="legend-row">
          {(['fatal', 'error', 'warning', 'info'] as const).map((level) => (
            <span className={LEVEL_CLASS[level]} key={level}>{t(`level.${level}`, level)}</span>
          ))}
        </div>

        <h3>{t('legend.groups')}</h3>
        <div className="legend-row">
          <span className="legend-card group-sample group-venture" />
          <span className="legend-why">{t('legend.ventureWhy')}</span>
        </div>


        <p className="quiet">{t('legend.moduleWhy')}</p>

        <h3>{t('legend.kinds')}</h3>
        <p className="quiet">{t('legend.kindsWhy')}</p>
        <div className="legend-row">
          {KINDS.map((kind: string) => <span className="kind" key={kind}>{t(kind)}</span>)}
        </div>
      </div>
    </Dialog>
  );
}
