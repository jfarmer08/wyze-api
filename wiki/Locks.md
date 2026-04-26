# Locks

Three lock families are supported, each on a different protocol:

| Lock | `product_model` | API |
|---|---|---|
| Wyze Lock (V1) | `YD.LO1` | "Ford" — `yd-saas-toc.wyzecam.com` |
| Wyze Lock Bolt V2 | `DX_LB2` | IoT3 — `app.wyzecam.com/app/v4/iot3` |
| Wyze Palm Lock | `DX_PVLOC` | IoT3 |

The V1 Lock additionally requires a Wyze Lock Gateway (`YD.GW1`) to be on the account.

## Wyze Lock (V1)

Highest-level helpers — pass the device object:

```js
const lock = await wyze.getDeviceByName("Front Door");
await wyze.lockLock(lock);    // wraps controlLock(mac, model, "remoteLock")
await wyze.unlockLock(lock);  // wraps controlLock(mac, model, "remoteUnlock")
const info = await wyze.lockInfo(lock); // wraps getLockInfo(mac, model)
```

Lower-level:

| Method | Notes |
|---|---|
| `controlLock(mac, model, action)` | `action` is `"remoteLock"` or `"remoteUnlock"` |
| `getLockInfo(mac, model)` | Returns lock state, battery, gateway info |

## Bolt V2 (IoT3)

```js
const lock = await wyze.getDeviceByName("Side Door");
await wyze.lockBoltV2Lock(lock.mac, lock.product_model);
await wyze.lockBoltV2Unlock(lock.mac, lock.product_model);

const props = await wyze.lockBoltV2GetProperties(lock.mac, lock.product_model);
// {
//   "lock::lock-status": ...,
//   "lock::door-status": ...,
//   "iot-device::iot-state": 1,
//   "battery::battery-level": 87,
//   "battery::power-source": ...,
//   "device-info::firmware-ver": "..."
// }
```

| Method | Notes |
|---|---|
| `lockBoltV2Lock(mac, model)` | Runs `lock::lock` action |
| `lockBoltV2Unlock(mac, model)` | Runs `lock::unlock` action |
| `lockBoltV2GetProperties(mac, model)` | Reads the lock/door/battery/firmware property bundle |

## Palm Lock (IoT3)

The Palm lock is normally controlled by the on-device fingerprint reader; this library only reads its state.

| Method | Notes |
|---|---|
| `palmLockGetProperties(mac, model)` | Reads lock-status, battery, iot-state, firmware |

## IoT3 generics

Use these for any future IoT3 device, or when you need a property/action not covered above.

| Method | Notes |
|---|---|
| `iot3GetProperties(mac, model, props)` | `props` is an array of strings like `"lock::lock-status"` |
| `iot3RunAction(mac, model, action)` | `action` is a string like `"lock::lock"` |

```js
const status = await wyze.iot3GetProperties(lock.mac, lock.product_model, [
  "lock::lock-status",
  "battery::battery-level",
]);
```

## Helper: getLockState

`getLockState(value)` is a sync helper that maps a raw lock-state code to `0` (unlocked) or `1` (locked):

```js
// 2 = unlocked → 0; anything else → 1
wyze.getLockState(2) // 0
wyze.getLockState(1) // 1
```

`getLockDoorState(value)` similarly maps door-state codes (≥ 2 → 1, else passthrough).

## Constructor options

| Option | Default | Notes |
|---|---|---|
| `fordAppKey` | constant | Required for V1 lock |
| `fordAppSecret` | constant | Required for V1 lock |

The IoT3 family piggybacks on the olive signing secret, so no extra options are needed.
