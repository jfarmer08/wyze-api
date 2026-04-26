# Cameras — Controls

Power, siren, lights, motion detection, notifications, and recording for Wyze Cam devices. For live video, see **[Camera Streaming](Camera-Streaming.md)** and **[Snapshot Capture](Snapshot-Capture.md)**.

## Power / privacy

```js
const cam = await wyze.getDeviceByName("Front Porch");

await wyze.cameraTurnOn(cam.mac, cam.product_model);
await wyze.cameraTurnOff(cam.mac, cam.product_model);
await wyze.cameraPrivacy(cam.mac, cam.product_model, "power_on");  // generic action key
```

| Method | Wraps |
|---|---|
| `cameraTurnOn(mac, model)` | `runAction(mac, model, "power_on")` |
| `cameraTurnOff(mac, model)` | `runAction(mac, model, "power_off")` |
| `cameraPrivacy(mac, model, value)` | `runAction(mac, model, value)` — pass any action key the camera supports |

## Siren

| Method | Notes |
|---|---|
| `cameraSirenOn(mac, model)` | Trigger siren |
| `cameraSirenOff(mac, model)` | Stop siren |
| `cameraSiren(mac, model, value)` | Generic — pass `"siren_on"` or `"siren_off"` |

## Floodlight

For cameras with integrated floodlights (Cam Floodlight, etc.).

| Method | Notes |
|---|---|
| `cameraFloodLightOn(mac, model)` | Sets property `P1056` to `"1"` |
| `cameraFloodLightOff(mac, model)` | Sets property `P1056` to `"2"` |
| `cameraFloodLight(mac, model, value)` | Set `P1056` to a custom value |

## Spotlight

For cameras with a spotlight (Cam v3, etc.).

| Method | Notes |
|---|---|
| `cameraSpotLightOn(mac, model)` | Sets property `P1056` to `"1"` |
| `cameraSpotLightOff(mac, model)` | Sets property `P1056` to `"2"` |
| `cameraSpotLight(mac, model, value)` | Set `P1056` to a custom value |

> Note: floodlight and spotlight share property `P1056`. The actual hardware behavior depends on the camera model.

## Motion detection

| Method | Notes |
|---|---|
| `cameraMotionOn(mac, model)` | Enables motion detection (`P1001` = `1`) |
| `cameraMotionOff(mac, model)` | Disables motion detection (`P1001` = `0`) |

## Sound notifications

| Method | Notes |
|---|---|
| `cameraSoundNotificationOn(mac, model)` | `P1048` = `"1"` |
| `cameraSoundNotificationOff(mac, model)` | `P1048` = `"0"` |

## Push notifications

| Method | Notes |
|---|---|
| `cameraNotificationsOn(mac, model)` | Enable push (`P1` = `"1"`) |
| `cameraNotificationsOff(mac, model)` | Disable push (`P1` = `"0"`) |
| `cameraNotifications(mac, model, value)` | Set `P1` to a custom value |

## Motion recording

Cloud recording on motion events.

| Method | Notes |
|---|---|
| `cameraMotionRecordingOn(mac, model)` | `P1047` = `"1"` |
| `cameraMotionRecordingOff(mac, model)` | `P1047` = `"0"` |
| `cameraMotionRecording(mac, model, value)` | Set `P1047` to a custom value |

## Garage door

For cameras configured with a Wyze garage-door controller.

```js
await wyze.garageDoor(cam.mac, cam.product_model);
```

Triggers `garage_door_trigger` — the camera's controller decides open vs. close based on the current door state.

## Reading status

Camera state is in `device.device_params`:

```js
const cam = await wyze.getDeviceByName("Front Porch");
const status = await wyze.getDeviceStatus(cam);
// status.power_switch, status.signal_strength, status.ip, etc.
```

For a single property:

```js
const motionEnabled = await wyze.getDeviceStatePID(cam.mac, cam.product_model, "P1001");
```

For the full list:

```js
const props = await wyze.getDevicePID(cam.mac, cam.product_model);
console.log(props.data.property_list);
```

## See also

- **[Camera Streaming](Camera-Streaming.md)** — fetch WebRTC credentials for live video
- **[Snapshot Capture](Snapshot-Capture.md)** — JPEG images (cloud or live)
- **[Browser Viewer Example](Browser-Viewer-Example.md)** — runnable end-to-end demo
