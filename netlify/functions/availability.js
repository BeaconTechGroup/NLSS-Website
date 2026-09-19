const CALENDAR_URL = process.env.NLSS_CALENDAR_ICS_URL;

function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function datePart(value) {
  const m = String(value || '').match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addDays(iso, days) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0,10);
}

function expandDates(start, end, allDay) {
  if (!start) return [];
  if (!end || end <= start) return [start];
  const out = [];
  let cur = start;
  const stop = allDay ? addDays(end, -1) : end;
  while (cur <= stop && out.length < 31) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out.length ? out : [start];
}

exports.handler = async function() {
  if (!CALENDAR_URL) {
    return {
      statusCode: 503,
      headers: {'Content-Type':'application/json','Cache-Control':'no-store'},
      body: JSON.stringify({error:'Availability sync is not configured yet.'})
    };
  }

  try {
    const response = await fetch(CALENDAR_URL, {
      headers: {'User-Agent':'NLSS-Availability/1.0'}
    });
    if (!response.ok) throw new Error(`Calendar returned ${response.status}`);

    const ics = unfoldIcs(await response.text());
    const events = ics.split('BEGIN:VEVENT').slice(1).map(x => x.split('END:VEVENT')[0]);
    const blocked = new Set();

    for (const event of events) {
      const startLine = event.match(/^DTSTART([^:]*)?:(.+)$/m);
      const endLine = event.match(/^DTEND([^:]*)?:(.+)$/m);
      if (!startLine) continue;

      const start = datePart(startLine[2]);
      const end = endLine ? datePart(endLine[2]) : null;
      const allDay = /VALUE=DATE/i.test(startLine[1] || '');

      for (const d of expandDates(start, end, allDay)) blocked.add(d);
    }

    const blockedDates = [...blocked].sort();
    return {
      statusCode: 200,
      headers: {
        'Content-Type':'application/json',
        'Cache-Control':'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin':'*'
      },
      body: JSON.stringify({
        blockedDates,
        updatedAt: new Date().toISOString(),
        source: 'NLSS calendar'
      })
    };
  } catch (err) {
    console.error('NLSS availability sync failed:', err);
    return {
      statusCode: 502,
      headers: {'Content-Type':'application/json','Cache-Control':'no-store'},
      body: JSON.stringify({error:'Live availability is temporarily unavailable.'})
    };
  }
};