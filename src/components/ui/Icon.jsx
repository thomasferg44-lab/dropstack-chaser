// One consistent line-icon set: 24px grid, 1.5px stroke, round joins, no
// fills (design spec §1). Paths drawn for this app; no icon dependency.
const P = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  camera: "M4 8.5A1.5 1.5 0 015.5 7h2l1.5-2h6L16.5 7h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  chat: "M4.5 18.5l1.2-3.6A7.5 7.5 0 1112 19.5a7.6 7.6 0 01-3.9-1.1L4.5 18.5z",
  mail: "M4 6.5h16v11H4zM4.5 7l7.5 6 7.5-6",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  download: "M12 4v11M7 10.5l5 5 5-5M5 19.5h14",
  doc: "M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 12h6M9.5 15.5h6",
  invoice: "M6.5 3.5h11v17l-2.75-1.75L12 20.5l-2.75-1.75L6.5 20.5zM9.5 8h5M9.5 11.5h5M9.5 15h3",
  trash: "M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 001.5 1.5h5.4a1.5 1.5 0 001.5-1.5L17 7M10.5 11v5.5M13.5 11v5.5",
  edit: "M5 19h3.5L18.5 9 15 5.5 5 15.5V19zM13 7.5L16.5 11",
  clock: "M12 20a8 8 0 100-16 8 8 0 000 16zM12 8v4.5l3 2",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  send: "M4 12l16-7.5L13.5 20l-2-6.5L4 12zM11.5 13.5L20 4.5",
  book: "M5 4.5h10.5a2 2 0 012 2V20H7a2 2 0 01-2-2V4.5zM5 18a2 2 0 012-2h10.5",
  list: "M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2z",
  logout: "M14.5 8V5.5h-9v13h9V16M10 12h10M17 9l3 3-3 3",
  search: "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L20 20",
  calendar: "M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4",
  alert: "M12 4l9 15.5H3L12 4zM12 10v4M12 17h.01",
  info: "M12 20a8 8 0 100-16 8 8 0 000 16zM12 11v5M12 8h.01",
  refresh: "M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4",
  sparkle: "M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2",
  layers: "M12 4l8.5 4.5L12 13 3.5 8.5 12 4zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5",
  pen: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14.5 6.5l3 3",
  wifiOff: "M3 4.5l18 15M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 014.4-2.4M19 12.5a10 10 0 00-3.2-2M12 19.5h.01M2 8.5a15 15 0 015.5-3M22 8.5a15 15 0 00-8-3.4",
  phone: "M6.5 4h3l1.5 4-2 1.5a11 11 0 005.5 5.5L16 13l4 1.5v3A2 2 0 0118 19.5 15.5 15.5 0 014.5 6 2 2 0 016.5 4z",
  home: "M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  inbox: "M4 13.5l2.5-8h11l2.5 8v5H4zM4 13.5h4.5l1 2h5l1-2H20",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 19.5a6.5 6.5 0 0113 0M16 4.3a3.5 3.5 0 010 6.4M18 14.2a6.5 6.5 0 013.5 5.3",
  upload: "M12 15.5V4M7 8.5l5-5 5 5M5 19.5h14",
  handshake: "M3 11l4-4 3 1 3-2 4 1 4 4M7 7l-4 4 6 6 2-1 2 2 2-1 2 1 3-3M10 16l2-2M12 18l2-2",
  cash: "M3.5 7h17v10h-17zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6.5 10h.01M17.5 14h.01",
  ladder: "M7 3.5v17M17 3.5v17M7 8h10M7 12.5h10M7 17h10",
  pulse: "M3 12h4l2-5 4 10 2-5h6",
  database: "M12 8c4.1 0 7.5-1.3 7.5-3S16.1 2 12 2 4.5 3.3 4.5 5 7.9 8 12 8zM4.5 5v14c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3",
};

export default function Icon({ name, size = 20, className = "", strokeWidth = 1.5, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
