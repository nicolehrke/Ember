// Gemeinsame Fetch-Helfer mit Timeout und verständlichen Fehlermeldungen.
// Netzwerkfehler (auch von CORS blockierte Abrufe) tragen err.code = 'network'.

async function request(url, { timeout = 10000 } = {}, read) {
  if (!navigator.onLine) throw new Error('Offline – keine Internetverbindung.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Der Server antwortet mit Fehler ${res.status}.`);
    return await read(res);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung beim Laden.');
    if (err instanceof TypeError) {
      const error = new Error('Netzwerkfehler – Server nicht erreichbar.');
      error.code = 'network';
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const fetchJSON = (url, options) => request(url, options, res => res.json());
export const fetchText = (url, options) => request(url, options, res => res.text());
