# Connect your dashboard to the water controller

This guide maps dashboard buttons and displays to the API implemented in
`controller.js`. The browser helper is `dashboard-client.js` in this folder.
The controller simulates one leak, **L-01**, supplying eight households from
one reservoir. Commands affect Blender when `blender_bridge.py` is running.

## 1. Start the connection

**Startup is manual.** Nothing in this project installs a background service,
scheduled task or automatic startup entry. The previously launched background
controller has been stopped. Run the following in your terminal when you need it:

```powershell
cd "C:\Users\eltal\Documents\Codex\2026-10-31\in-x20\outputs\water-controller"
node controller.js
```

Keep that terminal open during use. Press **Ctrl+C** in that terminal to stop
the controller. It stays stopped until you run `node controller.js` again.
The dashboard and Blender bridge do not launch Node; they only connect to it.
While Node is stopped, they cannot send commands or receive fresh readings.
The Blender bridge remains ready: starting Node starts the animation automatically,
and stopping Node pauses it within approximately 2 seconds. No timeline Play button
is needed. Restarting Node resumes the animation. This requires loading the bridge
once per Blender session; reopening Blender requires running the bridge again.
To allow your dashboard's browser origin, set the environment variable below
in the same terminal before running `node controller.js`.

The default API base URL is:

```text
http://127.0.0.1:8765
```

Start the controller with your dashboard's exact browser origin allowed.
For a dashboard running at `http://localhost:3000`, run these commands from
the controller folder:

```powershell
$env:DASHBOARD_ORIGIN = 'http://localhost:3000'
node controller.js
```

Use your actual dashboard port. `http://localhost:3000` and
`http://127.0.0.1:3000` are different origins. The value contains the scheme,
hostname and port, without a page path or trailing slash. Multiple allowed
origins can be separated with commas.

If the controller is already running, restart that instance with this setting;
do not start a second server on the same port. Changing the setting requires
a restart, which also resets the simulated state and incident history.

In Blender, open the township model, open `blender_bridge.py` in its Text Editor,
and run the script. The bridge drives motion itself; leave timeline playback
paused. Repeat this after reopening Blender.

Copy `dashboard-client.js` into your dashboard's source files and import it
from the correct relative path. Serve your dashboard through its development
server rather than opening an HTML file directly with `file://`.

## 2. Which buttons call which endpoints?

All paths below are relative to the API base URL. Every POST uses
`Content-Type: application/json`.

| Dashboard button | Method and endpoint | JSON request body | Browser helper | Result |
|---|---|---|---|---|
| **Start leak** | `POST /api/leak` | `{"pipeId":"L-01","active":true,"lossLps":3.6}` | `setLeak(true, 3.6)` | Starts the leak, shows spray and reduces household delivery to 4.4 L/s total. |
| **Apply leak rate** | `POST /api/leak` | `{"pipeId":"L-01","active":true,"lossLps":2}` | `setLeak(true, Number(input.value))` | Sets the loss to the entered number; 2 L/s leaves 6 L/s for the homes. Also starts a leak if none is active. |
| **Simulate full loss** (optional) | `POST /api/leak` | `{"pipeId":"L-01","active":true,"lossLps":8}` | `setLeak(true, 8)` | All supply is lost at L-01; downstream water motion stops. This does not turn off the reservoir. |
| **Repair leak** | `POST /api/leak` | `{"pipeId":"L-01","active":false,"lossLps":0}` | `setLeak(false)` | Stops spray and restores 1 L/s per household. |
| **Refresh readings** | `GET /api/state` | None | `fetch(API + '/api/state')` | Reads current flow, leak status and Blender connection status. |
| **Load incident history** | `GET /api/events` | None | `fetch(API + '/api/events')` | Returns the most recent 200 incident events, oldest first. |
| **Locate leak** (optional) | No additional endpoint | None | Read `state.leak.location` | Your dashboard highlights L-01 on its own map or diagram. This does not move Blender's camera. |

**There is no separate `/start`, `/stop` or `/repair` endpoint.** Start, update
and repair all use `/api/leak`; the JSON body selects the action.

Input rules:

- `active` must be a JSON boolean (`true` or `false`), not a string.
- For an active leak, `lossLps` must be a number greater than 0 and at most 8.
- For repair, omit `lossLps` or send 0. Do not send the previous positive rate.
- `pipeId` is optional, but the only supported value is `L-01`.
- Starting without `lossLps` uses 3.6 L/s. An identical command changes nothing
  and does not create another incident event.
- Use an Apply button for a slider/input; avoid submitting on every slider movement.

## 3. Wire the action buttons

Add these elements to the dashboard component or page:

```html
<label for="leakRate">Water lost at L-01 (L/s)</label>
<input id="leakRate" type="number" min="0.01" max="8" step="0.01" value="3.6">
<button id="startLeak" type="button">Start leak</button>
<button id="applyRate" type="button">Apply leak rate</button>
<button id="repairLeak" type="button">Repair leak</button>
<p id="commandMessage" role="status"></p>
```

Run the following from a browser ES module after those elements exist. In React,
Vue or another framework, use the same functions in your button event handlers
and store messages/pending status in component state.

```javascript
import { setLeak } from './dashboard-client.js';

const start = document.querySelector('#startLeak');
const apply = document.querySelector('#applyRate');
const repair = document.querySelector('#repairLeak');
const rate = document.querySelector('#leakRate');
const message = document.querySelector('#commandMessage');
const buttons = [start, apply, repair];

async function sendCommand(active, lossLps) {
  if (active && (!Number.isFinite(lossLps) || lossLps <= 0 || lossLps > 8)) {
    message.textContent = 'Enter a leak rate greater than 0 and no more than 8 L/s.';
    return;
  }
  buttons.forEach(button => { button.disabled = true; });
  message.textContent = 'Sending command…';
  try {
    const state = await setLeak(active, lossLps);
    message.textContent = `Command accepted (revision ${state.revision}). Checking Blender…`;
    // Use GET /api/state to update your cards and check blender.synchronized.
  } catch (error) {
    message.textContent = `Command failed: ${error.message}`;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

start.addEventListener('click', () => sendCommand(true, 3.6));
apply.addEventListener('click', () => sendCommand(true, Number(rate.value)));
repair.addEventListener('click', () => sendCommand(false, 0));
```

Start uses the default demonstration rate. Apply uses the input's current rate.
Disable command buttons while a request is pending to avoid overlapping actions.
A failed or timed-out request may still have reached the controller: refresh
the state before deciding whether to retry.

## 4. Display the current readings

Use `GET /api/state` on initial page load, after commands and about once a second
while the dashboard is open. Schedule the next poll after the previous request
finishes so slow requests do not accumulate. Handle fetch errors as **Controller
offline**, not as **No leak**; keep last readings visibly marked as stale.

| Dashboard display | Response field | Example during a 3.6 L/s leak |
|---|---|---|
| Leak badge | `leak.active` | `true` → “Leak active” |
| Pipe identifier | `leak.id` | `L-01` |
| Supply card | `supplyLps` | 8 L/s |
| Water loss card | `leak.lossLps` | 3.6 L/s |
| Total household delivery | `householdTotalLps` | 4.4 L/s |
| Delivery per household | `perHouseholdLps` | 0.55 L/s |
| Flow reduction | `(1 - flowMultiplier) * 100` | 45% |
| Leak map position | `leak.location` | `{x:-9, y:0, z:1.2}` in Blender scene coordinates, not GPS |
| Last state change | `updatedAt` | ISO timestamp; format in the viewer's local time |
| Controller session | `instanceId` | Changes when Node restarts |
| Command revision | `revision` | Increases with each actual leak-state change |

Keep controller availability and Blender status separate:

| Condition | Recommended dashboard status |
|---|---|
| State request fails | “Controller offline — readings may be stale” |
| Request succeeds; `blender.connected` is false | “Controller online — Blender disconnected” |
| `blender.connected` true; `blender.synchronized` false | “Blender connected — applying update” |
| `blender.synchronized` true | “Blender synchronized” |

HTTP 200 on a command means **accepted by the controller**. It does not by itself
prove Blender has updated. The bridge reports its applied revision separately.
Allow a few seconds for acknowledgement and keep polling. If multiple dashboard
users issue commands, state represents the latest accepted command.

## 5. Receive live incident alerts

`GET /api/stream` is a server-sent event (SSE) connection opened automatically by
`watchLeaks()`. Connect on dashboard load; it does not need a button.

```javascript
import { watchLeaks } from './dashboard-client.js';

const stopWatching = watchLeaks(
  state => {
    // Update flow cards, leak badge and map from this state.
    console.log('Live state:', state);
  },
  event => {
    // Add one alert/history row, keyed by event.id to avoid duplicates.
    console.log(event.type, event.time, event.state.leak.id);
  },
  () => {
    // Show a reconnecting indicator; EventSource retries automatically.
    console.log('Alert connection interrupted; reconnecting…');
  }
);

// Call stopWatching() when this page/component is removed.
```

| SSE event name | Meaning | Suggested UI response |
|---|---|---|
| `state` | Current snapshot on initial connection or reconnect | Refresh readings; do not create a new incident notification. |
| `leak_started` | A simulated leak became active | Show “Simulated leak at L-01” and highlight its location. |
| `leak_updated` | An active leak's loss rate changed | Update the flow cards and incident details. |
| `leak_repaired` | Leak became inactive | Mark the incident resolved and restore normal badge. |

The helper unwraps the SSE payload for you. On the raw stream, `state` contains
the state directly; incident events contain `{id, type, time, state}`.
Use named event listeners as the helper does, rather than only `onmessage`.

SSE incident messages are not periodic Blender-health updates. Continue polling
`/api/state` for connected/synchronized status even while SSE is working.
Avoid replacing newer readings with delayed responses: compare `instanceId`
and `revision` when combining polling, command responses and SSE updates.

## 6. Load history and understand the limits

The Load incident history button fetches `GET /api/events`. Render each entry's
`id`, `type`, `time` and `state.leak.lossLps`. Key rows by `id` and reverse the
array if you want newest first. Fetch history again after reconnecting to recover
incidents missed while offline; SSE reconnect provides a snapshot, not a replay.

History holds at most 200 events in memory. Restarting Node clears it and resets
the controller to normal flow. There is no clear-history button, persistent
database, sensor ingestion endpoint or real leak-detection algorithm here.
Label these controls and alerts as a simulation.

Do not attach dashboard buttons to `POST /api/blender`. That endpoint is only for
the Python bridge's acknowledgement. Sending fake acknowledgements would make
the dashboard incorrectly report that Blender applied a command.

## 7. Troubleshooting

| Symptom | What to check |
|---|---|
| Browser reports CORS or Failed to fetch | Ensure Node is running and restart it with the dashboard's exact `DASHBOARD_ORIGIN`. Check the browser network panel. |
| HTTP 400 | Check boolean `active`, numeric loss range and supported `pipeId`. The JSON response includes an `error` message. |
| HTTP 415 | Send `Content-Type: application/json`. |
| HTTP 413 | Keep the request body below 4096 bytes; send only the command fields. |
| HTTP 404 | Check the path and method against the button table. |
| EADDRINUSE when starting Node | Another process is already listening on port 8765; stop the existing controller before restarting it. |
| Dashboard changes but Blender does not | Open the correct model and run `blender_bridge.py`; inspect `blender.connected` and `blender.synchronized`. |
| Normal/leak state keeps switching on its own | Pause Blender's original timeline animation while using the live bridge. |
| App on another computer cannot connect | This controller binds to loopback only. `127.0.0.1` refers to each viewer's own computer. |

The current setup is for a local dashboard on the Blender computer. A hosted
dashboard needs a reachable backend with authentication and an appropriate HTTPS
deployment. CORS configuration alone does not expose the local server remotely.
If you change the controller port, also change the API URL in both
`dashboard-client.js` and `blender_bridge.py`.
