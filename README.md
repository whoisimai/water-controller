# Township JavaScript controller

Local Node.js controller for the supplied Blender township. No npm install needed.
Tested with Node.js 24 and Blender 5.2. Uses Node's built-in HTTP server:
https://nodejs.org/api/http.html

## Start

Startup is manual: no background service or automatic startup is installed.
Run `node controller.js` only when you want the controller running, keep its
terminal open, and press **Ctrl+C** there to stop it. Blender and the dashboard
do not start Node automatically. The previous background instance was stopped.

For button-to-endpoint mappings and dashboard examples, read `DASHBOARD_GUIDE.md`.

From this folder run:

```powershell
node controller.js
```

The controller listens only on `127.0.0.1:8765`. Leave that process running.
Open `../Township_Water_Digital_Twin.blend` in Blender. In the Scripting workspace,
open `blender_bridge.py` in the Text Editor and choose **Run Script** (Alt+P).
Return to Layout. Motion is driven by the bridge timer; do not start timeline playback.
Run the bridge again after reopening Blender. It does not run automatically on file open.

## Trigger a leak or repair it

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/leak -Method Post -ContentType application/json -Body '{"active":true,"lossLps":3.6}'
Invoke-RestMethod http://127.0.0.1:8765/api/leak -Method Post -ContentType application/json -Body '{"active":false}'
```

`lossLps` may be greater than 0 and at most 8 for an active leak. The only modeled
leak location is `L-01`, at (-9, 0, 1.2). Start defaults to 3.6 L/s loss.
An active loss of 8 stops downstream water; supply tracers keep moving.
Repair restores normal flow. Identical commands do not create duplicate events.

## Connect your dashboard

Before starting the controller, allow the exact origin where your dashboard runs:

```powershell
$env:DASHBOARD_ORIGIN='http://localhost:3000'
node controller.js
```

Multiple origins can be comma-separated. Import `dashboard-client.js` into your
browser app, call `setLeak(true, 3.6)` or `setLeak(false)`, and use `watchLeaks()` to
update your UI and create alerts. It returns a function to close the subscription.

```javascript
import { setLeak, watchLeaks } from './dashboard-client.js';
const unsubscribe = watchLeaks(
  state => console.log('Current readings:', state),
  event => console.log('Incident:', event.type, event.time),
  () => console.log('Controller connection interrupted; reconnecting')
);
await setLeak(true, 3.6);
// Later: await setLeak(false); unsubscribe();
```

| Endpoint | Purpose |
|---|---|
| GET /api/state | Current readings and Blender connection status |
| POST /api/leak | Start/update/repair with JSON `{active, lossLps?, pipeId?}` |
| GET /api/stream | Server-sent events: state, leak_started, leak_updated, leak_repaired |
| GET /api/events | Most recent 200 incident events |
| POST /api/blender | Bridge acknowledgement; handled by the Python script |

An HTTP success confirms the controller accepted a command. Check
`blender.synchronized` to confirm Blender has applied the current revision.
Poll `/api/state` to monitor connection status; incident events alone do not
report disconnections. SSE sends a current snapshot on reconnect; use
`/api/events` for missed incident history. Both state and history reset when
Node restarts. There is no database or real sensor detection in this prototype.

The bridge polls every 0.5 seconds in a background thread and updates Blender
on its main thread. Starting `node controller.js` automatically starts live
motion while the bridge is loaded. Stopping Node pauses all live motion and
shows an offline label; the last pose remains visible. Connection loss is
detected within approximately 2 seconds. The bridge stays ready and resumes
motion when you manually start Node again, without needing to rerun the bridge.
After reopening Blender, load the bridge once again. The dashboard is not
yet integrated into your existing app: the API and browser client are ready for it.

This is for local development, without authentication. A remotely hosted dashboard
needs a deployed authenticated backend; localhost refers to each viewer's own machine.
Changing CORS alone does not make this service remotely reachable.

## Stop / restore the original animation

In Blender's Python Console:

```python
bpy.app.driver_namespace['township_live_bridge'].stop()
```

This restores the original actions and labels. Then Space plays the original
20-second timed demonstration. Avoid saving over the original .blend while live
mode is active, since the bridge temporarily detaches its animated objects' actions.
Stop the controller with Ctrl+C. The supplied original .blend remains unchanged.

## Tests

```powershell
node --test controller.test.js
```

The tests use a separate random local port and cover flow balance, leak lifecycle,
SSE delivery, malformed input, supported location, CORS, idempotence and bridge status.
