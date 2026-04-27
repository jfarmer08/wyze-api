# Sensors

Wyze Sense — contact (`DWS3U`/`DWS2U`) and motion (`PIR3U`/`PIR2U`) sensors. Read-only family — state changes are reported by the sensor on the cloud, you can't tell the sensor to do anything.

## Lookup

| Method | Returns |
|---|---|
| `getContactSensorList()` | All contact sensors |
| `getContactSensor(mac)` | Single contact sensor by mac |
| `getContactSensorInfo(mac)` | List entry merged with device-info data |
| `getMotionSensorList()` | All motion sensors |
| `getMotionSensor(mac)` | Single motion sensor by mac |
| `getMotionSensorInfo(mac)` | List entry merged with device-info data |

## Pure accessors

Operate on a sensor info object (or any object with the same `device_params` shape). All return `null` when the field isn't present.

| Method | Returns |
|---|---|
| `contactSensorIsOpen(info)` | `boolean \| null` — open vs. closed |
| `motionSensorIsMotion(info)` | `boolean \| null` — motion detected |
| `sensorBatteryVoltage(info)` | battery voltage from `device_params.voltage` |
| `sensorRssi(info)` | Wi-Fi signal strength |

Plus the cross-cutting accessors that work on any device:
- `deviceGetBattery(info)` — best-effort battery reading
- `deviceIsLowBattery(info)` — applies the configured `lowBatteryPercentage` threshold
- `deviceGetSignalStrength(info)`, `deviceGetIp(info)`, `deviceGetFirmware(info)`, `deviceIsOnline(info)`, `deviceGetLastSeen(info)`

## Example

```js
const sensors = await wyze.getContactSensorList();
for (const s of sensors) {
  const info = await wyze.getContactSensorInfo(s.mac);
  console.log(`${s.nickname}: ${wyze.contactSensorIsOpen(info) ? "open" : "closed"}`);
  if (wyze.deviceIsLowBattery(info)) console.log(`  low battery: ${wyze.deviceGetBattery(info)}`);
}
```

## Models

| `product_model` | Device |
|---|---|
| `DWS3U` | Contact sensor (newer) |
| `DWS2U` | Contact sensor (older) |
| `PIR3U` | Motion sensor (newer) |
| `PIR2U` | Motion sensor (older) |
