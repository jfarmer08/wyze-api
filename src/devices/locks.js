const crypto = require("../utils/crypto");
const payloadFactory = require("../utils/payloadFactory");
const { DeviceModels, LockKeyPermissionType } = require("../types");

/**
 * Wyze Locks — three families:
 *   - V1 Lock (YD.LO1) via Ford service (yd-saas-toc.wyzecam.com)
 *   - Bolt V2 Lock (DX_LB2) via IoT3
 *   - Palm Lock (DX_PVLOC) via IoT3
 *
 * Plus access-code management on V1 (encrypted PINs via crypt secret).
 */
module.exports = {
  // ---- V1 Lock (Ford service) ----------------------------------------------

  async controlLock(deviceMac, deviceModel, action) {
    return this._fordPost("/openapi/lock/v1/control", {
      uuid: this.getUuid(deviceMac, deviceModel),
      action, // "remoteLock" or "remoteUnlock"
    });
  },

  async getLockInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/lock/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
      with_keypad: "1",
    });
  },

  async unlockLock(device) {
    return this.controlLock(device.mac, device.product_model, "remoteUnlock");
  },

  async lockLock(device) {
    return this.controlLock(device.mac, device.product_model, "remoteLock");
  },

  async lockInfo(device) {
    return this.getLockInfo(device.mac, device.product_model);
  },

  async getLockDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.LOCK.includes(d.product_model));
  },

  async getLockGatewayList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.LOCK_GATEWAY.includes(d.product_model));
  },

  async getLockKeypadInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/keypad/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  },

  async getLockGatewayInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/gateway/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  },

  /**
   * Get the secret used to encrypt new access codes.
   */
  async getLockCryptSecret() {
    return this._fordGet("/openapi/v1/crypt_secret");
  },

  async getLockRecordCount(deviceMac, deviceModel, since, until) {
    const begin = since instanceof Date ? since.getTime() : since;
    const params = {
      uuid: this.getUuid(deviceMac, deviceModel),
      begin: String(begin),
    };
    if (until != null) {
      params.end = String(until instanceof Date ? until.getTime() : until);
    }
    return this._fordGet("/openapi/v1/safety/count", params);
  },

  /**
   * Lock event records (lock/unlock with source).
   */
  async getLockRecords(deviceMac, deviceModel, options = {}) {
    const { since, until, limit = 20, offset = 0 } = options;
    if (since == null) throw new Error("getLockRecords: `since` is required");
    const begin = since instanceof Date ? since.getTime() : since;
    const params = {
      uuid: this.getUuid(deviceMac, deviceModel),
      begin: String(begin),
      offset: String(offset),
      limit: String(limit),
    };
    if (until != null) {
      params.end = String(until instanceof Date ? until.getTime() : until);
    }
    return this._fordGet("/openapi/v1/safety/family_record", params);
  },

  async getLockKeys(deviceMac, deviceModel) {
    return this._fordGet("/openapi/lock/v1/pwd", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  },

  // ---- Access-code management ----------------------------------------------

  /**
   * Build a JSON-ready LockKeyPermission. Per type:
   *   - ALWAYS    (1): no time bounds
   *   - DURATION  (2): begin/end (epoch seconds)
   *   - ONCE      (3): begin/end (single window)
   *   - RECURRING (4): begin/end forced to 0; pair with periodicity
   */
  buildLockKeyPermission(type, begin, end) {
    if (!Object.values(LockKeyPermissionType).includes(type)) {
      throw new Error(`buildLockKeyPermission: invalid type ${type}`);
    }
    const out = { status: type };
    const toEpochSec = (v) => {
      if (v == null) return null;
      if (v instanceof Date) return Math.floor(v.getTime() / 1000);
      if (typeof v === "number") return Math.floor(v);
      throw new Error("buildLockKeyPermission: begin/end must be Date or epoch seconds");
    };
    if (type === LockKeyPermissionType.RECURRING) {
      out.begin = 0;
      out.end = 0;
    } else if (
      type === LockKeyPermissionType.DURATION ||
      type === LockKeyPermissionType.ONCE
    ) {
      const b = toEpochSec(begin);
      const e = toEpochSec(end);
      if (b !== null) out.begin = b;
      if (e !== null) out.end = e;
    }
    return out;
  },

  /**
   * Build a JSON-ready LockKeyPeriodicity for RECURRING access codes.
   */
  buildLockKeyPeriodicity({ begin, end, validDays }) {
    const fmt = (v) => {
      if (typeof v === "string") {
        if (!/^\d{6}$/.test(v)) throw new Error("buildLockKeyPeriodicity: time must be HHMMSS");
        return v;
      }
      if (v instanceof Date) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(v.getHours())}${pad(v.getMinutes())}00`;
      }
      throw new Error("buildLockKeyPeriodicity: time must be Date or HHMMSS string");
    };
    if (!Array.isArray(validDays) || validDays.length === 0) {
      throw new Error("buildLockKeyPeriodicity: validDays must be a non-empty array");
    }
    return {
      type: 2,
      interval: 1,
      begin: fmt(begin),
      end: fmt(end),
      valid_days: validDays,
    };
  },

  async addLockAccessCode(deviceMac, deviceModel, options) {
    const { accessCode, name, userId, permission, periodicity } = options;
    if (!/^\d{4,8}$/.test(String(accessCode))) {
      throw new Error("addLockAccessCode: accessCode must be 4–8 digits");
    }
    if (!userId) throw new Error("addLockAccessCode: userId is required");

    const perm = permission ?? this.buildLockKeyPermission(LockKeyPermissionType.ALWAYS);
    if (perm.status === LockKeyPermissionType.RECURRING && !periodicity) {
      throw new Error("addLockAccessCode: periodicity is required when permission.type is RECURRING");
    }

    const secretResp = await this.getLockCryptSecret();
    const secret = secretResp?.secret;
    if (!secret) throw new Error("addLockAccessCode: failed to fetch crypt secret");

    const params = {
      uuid: this.getUuid(deviceMac, deviceModel),
      userid: userId,
      password: crypto.encryptLockAccessCode(accessCode, secret),
      permission: JSON.stringify(perm),
    };
    if (name) params.name = name;
    if (periodicity) params.period_info = JSON.stringify(periodicity);

    return this._fordPost("/openapi/lock/v1/pwd/operations/add", params);
  },

  async updateLockAccessCode(deviceMac, deviceModel, options) {
    const { accessCodeId, accessCode, name, permission, periodicity } = options;
    if (accessCodeId == null) throw new Error("updateLockAccessCode: accessCodeId is required");
    if (!permission) throw new Error("updateLockAccessCode: permission is required");
    if (permission.status === LockKeyPermissionType.RECURRING && !periodicity) {
      throw new Error("updateLockAccessCode: periodicity is required when permission.type is RECURRING");
    }

    const params = {
      uuid: this.getUuid(deviceMac, deviceModel),
      passwordid: String(accessCodeId),
      permission: JSON.stringify(permission),
    };
    if (accessCode != null) {
      if (!/^\d{4,8}$/.test(String(accessCode))) {
        throw new Error("updateLockAccessCode: accessCode must be 4–8 digits");
      }
      const secretResp = await this.getLockCryptSecret();
      const secret = secretResp?.secret;
      if (!secret) throw new Error("updateLockAccessCode: failed to fetch crypt secret");
      params.password = crypto.encryptLockAccessCode(accessCode, secret);
    }
    if (name) params.name = name;
    if (periodicity) params.period_info = JSON.stringify(periodicity);

    return this._fordPost("/openapi/lock/v1/pwd/operations/update", params);
  },

  async deleteLockAccessCode(deviceMac, deviceModel, accessCodeId) {
    if (accessCodeId == null) throw new Error("deleteLockAccessCode: accessCodeId is required");
    return this._fordPost("/openapi/lock/v1/pwd/operations/delete", {
      uuid: this.getUuid(deviceMac, deviceModel),
      passwordid: String(accessCodeId),
    });
  },

  /**
   * Rename an access code. Uses HTTP PUT (per Wyze API).
   */
  async renameLockAccessCode(deviceMac, deviceModel, accessCodeId, nickname) {
    if (accessCodeId == null) throw new Error("renameLockAccessCode: accessCodeId is required");
    if (!nickname) throw new Error("renameLockAccessCode: nickname is required");
    return this._fordPost(
      "/openapi/lock/v1/pwd/nickname",
      {
        uuid: this.getUuid(deviceMac, deviceModel),
        passwordid: String(accessCodeId),
        nickname,
      },
      "put"
    );
  },

  /**
   * Combined snapshot — list entry + lock info + crypt secret + record
   * count. Tolerates partial sub-fetch failures.
   */
  async getLockFullInfo(mac) {
    const devices = await this.getLockDeviceList();
    const lock = devices.find((d) => d.mac === mac);
    if (!lock) return null;

    const result = { ...lock };
    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        this.log.warning(`getLockFullInfo: ${label} failed: ${err.message}`);
        return null;
      }
    };

    const lockInfo = await safe("lock_info", () =>
      this.getLockInfo(lock.mac, lock.product_model)
    );
    if (lockInfo?.device) {
      result.device_params = { ...(result.device_params || {}), ...lockInfo.device };
    }

    const secret = await safe("crypt_secret", () => this.getLockCryptSecret());
    if (secret?.secret) result.secret = secret.secret;

    const count = await safe("record_count", () =>
      this.getLockRecordCount(lock.mac, lock.product_model, 0)
    );
    if (count?.cnt != null) result.record_count = count.cnt;

    return result;
  },

  // ---- Device-object helpers -----------------------------------------------

  async lockKeypad(device) {
    return this.getLockKeypadInfo(device.mac, device.product_model);
  },

  async lockGateway(device) {
    return this.getLockGatewayInfo(device.mac, device.product_model);
  },

  async lockRecords(device, options = {}) {
    return this.getLockRecords(device.mac, device.product_model, options);
  },

  async lockKeys(device) {
    return this.getLockKeys(device.mac, device.product_model);
  },

  async lockFullInfo(device) {
    return this.getLockFullInfo(device.mac);
  },

  // ---- IoT3 (Bolt V2 + Palm) -----------------------------------------------

  async iot3GetProperties(deviceMac, deviceModel, props) {
    await this.maybeLogin();
    const payload = payloadFactory.iot3CreateGetPayload(
      deviceMac,
      this._iot3ExtractModel(deviceMac, deviceModel),
      props
    );
    return this._iot3Post("/app/v4/iot3/get-property", payload);
  },

  async iot3RunAction(deviceMac, deviceModel, action) {
    await this.maybeLogin();
    const payload = payloadFactory.iot3CreateRunActionPayload(
      deviceMac,
      this._iot3ExtractModel(deviceMac, deviceModel),
      action,
      this.username
    );
    return this._iot3Post("/app/v4/iot3/run-action", payload);
  },

  async lockBoltV2GetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "lock::door-status",
      "iot-device::iot-state",
      "battery::battery-level",
      "battery::power-source",
      "device-info::firmware-ver",
    ]);
  },

  async lockBoltV2Lock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::lock");
  },

  async lockBoltV2Unlock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::unlock");
  },

  // Device-object helpers for BoltV2 (accept a `device` with .mac + .product_model)

  async lockBoltV2Properties(device) {
    return this.lockBoltV2GetProperties(device.mac, device.product_model);
  },

  async lockBoltV2LockDevice(device) {
    return this.lockBoltV2Lock(device.mac, device.product_model);
  },

  async lockBoltV2UnlockDevice(device) {
    return this.lockBoltV2Unlock(device.mac, device.product_model);
  },

  async palmLockGetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "battery::battery-level",
      "iot-device::iot-state",
      "device-info::firmware-ver",
    ]);
  },
};
