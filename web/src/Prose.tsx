/**
 * A card's text, with the two things in it that are addresses.
 *
 * A card key IS a link — it is the one thing on this board that means exactly
 * one card — and it stood in the text as plain characters you had to type into
 * the search field. A Sentry permalink stood there as a bare URL you could not
 * press either.
 *
 * NOTHING ELSE IS TOUCHED. No markdown, no headings, no bold: a card's text is
 * a person's sentences, and a renderer that reinterprets them turns an
 * asterisk in a shell command into italics. Whitespace is kept as written.
 */
import type { ReactNode } from 'react';

/** A card key or a bare http(s) address — the two things worth pressing. */
const ADDRESS = /\b([A-Z]{2,8}-\d{1,7})\b|(https?:\/\/[^\s<>"')]+)/g;

export default function Prose({ text, open }: { text: string; open: (key: string) => void }) {
  const out: ReactNode[] = [];
  let last = 0;
  let found: RegExpExecArray | null;
  ADDRESS.lastIndex = 0;
  while ((found = ADDRESS.exec(text)) !== null) {
    if (found.index > last) out.push(text.slice(last, found.index));
    const [whole, key, url] = found;
    if (key) {
      out.push(
        <button key={`${found.index}-${key}`} className="key link" onClick={() => open(key)}>{key}</button>,
      );
    } else {
      out.push(
        <a key={`${found.index}-${url}`} href={url} target="_blank" rel="noreferrer">{url}</a>,
      );
    }
    last = found.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <p className="text">{out}</p>;
}
