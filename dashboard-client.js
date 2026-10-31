// Browser ES module: import { setLeak, watchLeaks } from './dashboard-client.js';
const API = 'http://127.0.0.1:8765';

export async function setLeak(active, lossLps = active ? 3.6 : 0) {
  const response = await fetch(`${API}/api/leak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeId: 'L-01', active, lossLps })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export function watchLeaks(onState, onEvent = () => {}, onConnectionError = () => {}) {
  const stream = new EventSource(`${API}/api/stream`);
  // A fresh state snapshot arrives on initial connection and automatic reconnect.
  stream.addEventListener('state', event => onState(JSON.parse(event.data)));
  for (const type of ['leak_started', 'leak_updated', 'leak_repaired']) {
    stream.addEventListener(type, event => { const data = JSON.parse(event.data); onState(data.state); onEvent(data); });
  }
  stream.onerror = onConnectionError;
  return () => stream.close();
}
