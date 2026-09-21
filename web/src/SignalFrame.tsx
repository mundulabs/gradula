import type { CSSProperties, ReactNode } from 'preact/compat';
import { beamFor, type Signal } from './motion';
const SIGNAL_CLASS: Record<Signal,string> = {working:'signal-working',attention:'signal-attention',changed:'signal-changed'};
/** Gradula-owned state cues. Motion is optional; state remains visible without it. */
export default function SignalFrame({signal,children}:{signal:Signal|null;children:ReactNode}) {
  const setting=beamFor(signal);
  if(!signal||!setting)return <>{children}</>;
  return <div className={`signal-frame ${SIGNAL_CLASS[signal]}`} style={{'--signal-duration':`${setting.duration}s`} as CSSProperties}>{children}</div>;
}
