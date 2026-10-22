// Gemeinsamer Fetch-Helfer mit Timeout und verständlichen Fehlermeldungen.

export async function fetchJSON(url, { timeout = 10000 } = {}) {
  if (!navigator.onLine) throw new Error('Offline – keine Internetverbindung.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Der Server antwortet mit Fehler ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung beim Laden.');
    if (err instanceof TypeError) throw new Error('Netzwerkfehler – Server nicht erreichbar.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
