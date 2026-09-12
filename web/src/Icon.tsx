const paths = {
  close: 'M6 6l12 12M6 18L18 6',
  more: 'M5 11v2m7-2v2m7-2v2',
  plus: 'M12 5v14M5 12h14',
  filter: 'M4 6h16M7 12h10M10 18h4',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',
  arrow: 'M9 5l7 7-7 7',
};
export default function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
