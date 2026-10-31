"""Run in Blender's Text Editor. Node controller must run separately.
Network work stays in a worker; bpy updates run only on Blender's main timer.
Re-running is safe. stop_bridge() restores the original timeline animation.
"""
import bpy, json, math, queue, threading, time, urllib.request
from mathutils import Vector

API = 'http://127.0.0.1:8765'
KEY = 'township_live_bridge'

class TownshipBridge:
    def __init__(self):
        self.scene = bpy.data.scenes.get('Township | Water network')
        if not self.scene: raise RuntimeError('Open Township_Water_Digital_Twin.blend first')
        self.messages = queue.Queue(); self.acks = queue.Queue(); self.quit = threading.Event()
        self.state = None; self.elapsed = 0.; self.last = time.monotonic(); self.distance = 0.; self.downstream = 0.
        self.received = 0.; self.online = False; self.originals = []; self.texts = []
        self.timer = self.tick
        self.tracers = []
        # Use the actual modeled cylinders to discover each pipe's endpoints.
        for obj in self.scene.objects:
            if ' flow ' not in obj.name: continue
            segment, index = obj.name.rsplit(' flow ', 1)
            shell = self.scene.objects.get(segment + ' transparent shell')
            if not shell: raise RuntimeError('Missing pipe: ' + segment)
            points = [shell.matrix_world @ Vector(v) for v in shell.bound_box]
            direction = shell.rotation_euler.to_quaternion() @ Vector((0, 0, 1))
            length = max(p.dot(direction) for p in points) - min(p.dot(direction) for p in points)
            start = shell.location - direction * length / 2
            count = max(3, int(length / 1.1 + 1e-5))
            self.tracers.append((obj, start, direction, length, int(index) / count * length, bool(shell.get('reduced_by_leak'))))
        if len(self.tracers) < 14: raise RuntimeError('Expected township flow tracers are missing')
        controlled = [o for o, *_ in self.tracers]
        self.drops = [self.scene.objects[f'Leak spray droplet {k:02d}'] for k in range(22)]
        self.puddle = self.scene.objects['Growing water puddle']; self.halo = self.scene.objects['Leak alert halo']
        self.warning = self.scene.objects['Leak warning']; self.loss = self.scene.objects['Leak loss']
        self.normal = self.scene.objects['Normal state']; self.alert = self.scene.objects['Leak state']
        controlled += self.drops + [self.puddle, self.halo, self.warning, self.loss, self.normal, self.alert]
        for obj in controlled:
            action = obj.animation_data.action if obj.animation_data else None
            slot = obj.animation_data.action_slot if action else None
            self.originals.append((obj, action, slot, obj.location.copy(), obj.scale.copy()))
        for obj in [self.loss, self.alert, self.scene.objects['Scenario explanation']]: self.texts.append((obj, obj.data.body))

    def start(self):
        if bpy.context.screen and bpy.context.screen.is_animation_playing: bpy.ops.screen.animation_cancel(restore_frame=False)
        for obj, action, *_ in self.originals:
            if action: obj.animation_data.action = None
        self.scene.objects['Scenario explanation'].data.body = 'PAUSED / start node controller.js to begin'
        self.scene['controller_connected'] = False
        self.scene['controller_animation_running'] = False
        self.worker = threading.Thread(target=self.poll, daemon=True); self.worker.start()
        bpy.app.timers.register(self.timer, first_interval=.1)

    def poll(self):
        # Ignore system proxies for the local controller.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ack = None
        while not self.quit.is_set():
            try:
                with opener.open(API + '/api/state', timeout=1) as response: state = json.load(response)
                self.messages.put((time.monotonic(), state))
                while not self.acks.empty(): ack = self.acks.get_nowait()
                if ack and ack['instanceId'] == state['instanceId']:
                    request = urllib.request.Request(API + '/api/blender', json.dumps(ack).encode(), {'Content-Type':'application/json'})
                    with opener.open(request, timeout=1): pass
            except Exception as error:
                # Explicit failure pauses motion without disabling reconnection.
                self.messages.put((time.monotonic(), None))
            self.quit.wait(.5)

    def tick(self):
        if self.quit.is_set(): return None
        try:
            while not self.messages.empty():
                received, state = self.messages.get_nowait()
                self.online = state is not None
                if state is not None: self.state = state; self.received = received
            now = time.monotonic(); dt = min(now-self.last,.15); self.last=now
            online = self.online and self.state is not None and now-self.received < 2
            self.scene['controller_connected'] = bool(online)
            self.scene['controller_animation_running'] = bool(online)
            # The live bridge owns motion; the saved timed demo must not compete.
            if bpy.context.screen and bpy.context.screen.is_animation_playing:
                bpy.ops.screen.animation_cancel(restore_frame=False)
            if not online:
                self.scene.objects['Scenario explanation'].data.body = 'PAUSED / controller offline / run node controller.js'
                for screen in bpy.data.screens:
                    for area in screen.areas:
                        if area.type=='VIEW_3D':area.tag_redraw()
                return .1
            self.elapsed+=dt
            st=self.state; active=st['leak']['active']; factor=st['flowMultiplier']
            self.distance += 2.2*dt; self.downstream += 2.2*factor*dt
            for obj, start, direction, length, phase, affected in self.tracers:
                obj.location=start+direction*((phase+(self.downstream if affected else self.distance))%length)
            for k,obj in enumerate(self.drops):
                t=(self.elapsed+k/22*.85)%.85
                obj.location=(-9+math.sin(k*2.4)*.7*t,-.15-2*t,1.2+4.8*t-5*t*t)
                obj.scale=(1,1,1) if active else (0,0,0)
            self.puddle.scale=(1.5,1.05,.055) if active else (0,0,0)
            pulse=1+.15*math.sin(self.elapsed*5)
            self.halo.scale=(pulse,pulse,1) if active else (0,0,0)
            for obj in [self.warning,self.loss,self.alert]:obj.scale=(1,1,1) if active else (0,0,0)
            self.normal.scale=(0,0,0) if active else (1,1,1)
            self.loss.data.body=f"LOSS {st['leak']['lossLps']:.2f} L/s"
            self.alert.data.body=f"LEAK L-01  |  SUPPLY 8.0 / HOMES {st['householdTotalLps']:.2f} / LOSS {st['leak']['lossLps']:.2f} L/s"
            self.scene.objects['Scenario explanation'].data.body=f"LIVE / {st['perHouseholdLps']:.2f} L/s per home / {(1-factor)*100:.0f}% reduction"
            self.scene['controller_revision']=st['revision']; self.scene['controller_instance']=st['instanceId']
            self.scene['controller_connected']=online;self.scene['live_leak_active']=active;self.scene['live_flow_multiplier']=factor
            if online and (not hasattr(self,'acked') or self.acked!=(st['instanceId'],st['revision'])):
                self.acks.put({'instanceId':st['instanceId'],'revision':st['revision']});self.acked=(st['instanceId'],st['revision'])
            for screen in bpy.data.screens:
                for area in screen.areas:
                    if area.type=='VIEW_3D':area.tag_redraw()
            return 1/24
        except Exception as error:
            print('Township bridge stopped:',error);self.stop();return None

    def stop(self):
        self.quit.set()
        if bpy.app.timers.is_registered(self.timer):bpy.app.timers.unregister(self.timer)
        for obj,action,slot,location,scale in self.originals:
            obj.location=location;obj.scale=scale
            if action:
                obj.animation_data.action=action
                if slot:obj.animation_data.action_slot=slot
        for obj,body in self.texts:obj.data.body=body
        self.scene.frame_set(self.scene.frame_current)
        self.scene['controller_connected']=False
        self.scene['controller_animation_running']=False

def stop_bridge():
    old=bpy.app.driver_namespace.pop(KEY,None)
    if old:old.stop()

stop_bridge()
bridge=TownshipBridge();bridge.start();bpy.app.driver_namespace[KEY]=bridge
print('Township live bridge running:',API)
