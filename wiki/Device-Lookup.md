# Device Lookup

Every device family in this library starts with finding the device. The lookups below all hit one cached response from `getObjectList()` (the underlying Wyze "home page" call), so calling several in a row is cheap.

## Listing

| Method | Returns |
|---|---|
| `getDeviceList()` | `Device[]` — all devices on the account |
| `getDeviceGroupsList()` | groups (rooms / device groups) |
| `getDeviceSortList()` | the user-defined display order |
| `getObjectList()` | raw response (`{data: {device_list, device_group_list, device_sort_list}, ...}`) |
| `getObjectListSafe()` | same as `getObjectList()` but errors are logged and re-thrown with context |

## Finding one device

```js
const camera = await wyze.getDeviceByName("Front Porch");
const lock = await wyze.getDeviceByMac("AA:BB:CC:DD:EE:FF");
const cameras = await wyze.getDevicesByType("Camera");          // case-insensitive
const bulbs = await wyze.getDevicesByModel("WLPA19C");          // case-insensitive
```

| Method | Returns |
|---|---|
| `getDeviceByName(nickname)` | `Device \| undefined` (case-insensitive) |
| `getDeviceByMac(mac)` | `Device \| undefined` (exact match) |
| `getDevicesByType(type)` | `Device[]` — `product_type` match (e.g. `"Camera"`, `"Light"`, `"Plug"`, `"Lock"`) |
| `getDevicesByModel(model)` | `Device[]` — `product_model` match (e.g. `"WLPA19C"`, `"JA_RO2"`) |

## Inspecting state

| Method | Notes |
|---|---|
| `getDeviceStatus(device)` | `device.device_params` snapshot returned by the Wyze object list |
| `getDeviceState(device)` | Convenience: returns `"on"`/`"off"` for plugs/lights, `"open"`/`"closed"` for sensors, `""` if unknown |
| `getDevicePID(mac, model)` | Calls `app/v2/device/get_property_list` — full property list |
| `getDeviceStatePID(mac, model, pid)` | Looks up a single property by PID; returns `1` (truthy `"1"`), `0` (anything else), or `""` (not found) |

## Family-specific lookups

Some families ship richer lookup helpers that filter and shape the result for you:

- **[Cameras](Camera-Streaming.md#lookup)** — `getCameras()`, `getOnlineCameras()`, `getCamera(mac)`, `getCameraByName(nickname)`, `getCameraSummaries()`
- **[Robot Vacuum](Robot-Vacuum.md#lookup)** — `getVacuumDeviceList()`, `getVacuum(mac)`, `getVacuumInfo(mac)`

These wrap the generic helpers so you don't have to remember `product_type` strings or model codes.

## Device shape

The exact fields vary by `product_type`/`product_model`, but you can reliably expect:

```js
{
  mac: "AA:BB:CC:DD:EE:FF",         // or a model-prefixed string for some devices
  product_model: "WYZE_CAKP2JFUS",  // device model code
  product_type: "Camera",
  nickname: "Front Porch",
  device_params: { ... },           // device-specific runtime state
  conn_state: 1,                    // 1 == online, 0 == offline (where present)
  firmware_ver: "...",
  // ...lots more
}
```

Always log a sample (`console.log(device)`) when wiring up a new device family — the field set varies.

## Patterns

**Find one camera, control it:**

```js
const cam = await wyze.getDeviceByName("Garage");
await wyze.cameraTurnOn(cam.mac, cam.product_model);
```

**Iterate by family:**

```js
for (const lock of await wyze.getDevicesByType("Lock")) {
  console.log(`${lock.nickname}: ${await wyze.getLockInfo(lock.mac, lock.product_model)}`);
}
```

**Branch by model:**

```js
const lock = await wyze.getDeviceByName("Front Door");
if (lock.product_model === "DX_LB2") {
  await wyze.lockBoltV2Lock(lock.mac, lock.product_model);
} else if (lock.product_model === "YD.LO1") {
  await wyze.lockLock(lock);
}
```
