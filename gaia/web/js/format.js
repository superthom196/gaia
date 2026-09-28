// Times, numbers and places, the way Gaia shows them: metric, 24-hour, the
// viewer's own time zone (on the TV stream: the box's).

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

export const time = (d) => clock.format(new Date(d));
export const date = (d) => day.format(new Date(d));
export const dateTime = (d) => dayTime.format(new Date(d));

/** "47m", "3h 12m", "2d" */
export function ago(iso, now = Date.now()) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 && h < 10 ? `${h}h ${mins % 60}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function coords([lon, lat]) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export const kt2kmh = (kt) => Math.round(kt * 1.852);

export function num(n, digits = 0) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
