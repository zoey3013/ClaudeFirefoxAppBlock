/*
 * Public holidays by country, exposed as `Holidays`. Each country has a source URL and a
 * parser that turns the response into [{ date: 'YYYY-MM-DD', name }] — the days people
 * actually have off, so holidays moved to another day use the new date.
 */
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  /** Calendar date of an instant in a fixed UTC offset (hours), e.g. -4 for Santo Domingo. */
  function dateAt(iso, offsetHours) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const d = new Date(t + offsetHours * 3600000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const COUNTRIES = {
    DO: {
      // Ministerio de Trabajo, República Dominicana. Years → months → events; dates are
      // midnight in Santo Domingo (UTC−4, no daylight saving) written in UTC.
      url: 'https://webapi.mt.gob.do/api/holidays',
      parse(json) {
        const days = [];
        for (const year of Array.isArray(json) ? json : []) {
          for (const month of (year && year.items) || []) {
            for (const e of (month && month.events) || []) {
              if (!e || typeof e.title !== 'string') continue;
              const date = dateAt(e.moved && e.movedTo ? e.movedTo : e.date, -4);
              if (date) days.push({ date, name: e.title.trim() });
            }
          }
        }
        return days;
      },
    },
  };

  /** Parse a country's response; sorted by date, one entry per date. */
  function parse(country, json) {
    const c = COUNTRIES[country];
    if (!c) return [];
    const seen = new Set();
    return c.parse(json)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !seen.has(d.date) && seen.add(d.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  const api = { COUNTRIES, parse, dateAt };
  root.Holidays = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
