const {
  propertyIds: PIDs,
  DeviceModels,
  LightVisualEffectModel,
  LightVisualEffectRunType,
  LightVisualEffectModelsWithDirection,
  LightControlMode,
  LightPowerLossRecoveryMode,
} = require("../types");

/**
 * Wyze Bulb / Light / Mesh Bulb / Light Strip / Light Strip Pro.
 *
 * Two control surfaces:
 *   - Direct: white bulbs (WLPA19, HL_HWB2). setProperty / setBrightness etc.
 *   - Mesh:   color bulbs and strips (WLPA19C, HL_LSL, HL_LSLP) — go via
 *             runActionList with set_mesh_property because the device sits
 *             behind the Wyze hub mesh.
 *
 * Many setters branch on `deviceModel` to pick the right path.
 */
module.exports = {
  // ---- Basic light power (direct) ------------------------------------------

  async lightPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, value);
  },

  async lightTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "1");
  },

  async lightTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "0");
  },

  async lightTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async lightTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearLightTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  // Convenience aliases — bulb-named timers (same wire as light timers).
  async bulbTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async bulbTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearBulbTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.BRIGHTNESS, value);
  },

  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
  },

  // ---- Lookup --------------------------------------------------------------

  async getBulbDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.BULB.includes(d.product_model));
  },

  async getBulb(mac) {
    const bulbs = await this.getBulbDeviceList();
    return bulbs.find((d) => d.mac === mac);
  },

  /**
   * Combined snapshot — list entry merged with property list.
   */
  async getBulbInfo(mac) {
    const bulb = await this.getBulb(mac);
    if (!bulb) return null;
    const result = { ...bulb };
    try {
      const props = await this.getDevicePID(bulb.mac, bulb.product_model);
      if (props?.data?.property_list) {
        for (const p of props.data.property_list) {
          if (p?.pid) result[p.pid] = p.value;
        }
      }
    } catch (err) {
      this.log.warning(`getBulbInfo: property list failed: ${err.message}`);
    }
    return result;
  },

  // ---- Sun match (special: mesh bulbs need set_property_list, not single) --

  async setBulbSunMatch(deviceMac, deviceModel, enabled) {
    const value = enabled ? "1" : "0";
    if (
      DeviceModels.MESH_BULB.includes(deviceModel) &&
      !DeviceModels.LIGHT_STRIP.includes(deviceModel)
    ) {
      // Mesh color bulbs (WLPA19C) need set_property_list (plural) —
      // set_property (singular) silently no-ops for them.
      return this.setPropertyList(deviceMac, deviceModel, [
        { pid: PIDs.SUN_MATCH, pvalue: value },
      ]);
    }
    return this.setProperty(deviceMac, deviceModel, PIDs.SUN_MATCH, value);
  },

  /**
   * Toggle music-sync mode on a light strip. Writes P1535 only (separate
   * from `setBulbEffect` which writes the full effect plist).
   */
  async setBulbMusicMode(deviceMac, deviceModel, enabled) {
    if (!DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
      throw new Error(`setBulbMusicMode: ${deviceModel} is not a light strip`);
    }
    return this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.MUSIC_MODE,
      enabled ? "1" : "0",
      "set_mesh_property"
    );
  },

  /**
   * Try a local LAN command on a bulb first, fall back to a cloud action
   * on failure. Device object must include `enr` and `device_params.ip`
   * (both come from getDeviceList).
   */
  async bulbLocalOrCloud(device, propertyId, propertyValue, actionKey) {
    const enr = device?.enr;
    const ip = device?.device_params?.ip;
    if (enr && ip) {
      try {
        return await this.localBulbCommand(
          device.mac,
          device.product_model,
          enr,
          ip,
          propertyId,
          propertyValue
        );
      } catch (err) {
        if (this.apiLogEnabled) {
          this.log.info(`Local bulb command failed, falling back to cloud: ${err.message}`);
        }
      }
    }
    return this.runActionList(
      device.mac,
      device.product_model,
      propertyId,
      propertyValue,
      actionKey
    );
  },

  /**
   * Set behavior on power restore. P1509 with `LightPowerLossRecoveryMode`.
   */
  async setBulbPowerLossRecovery(deviceMac, deviceModel, mode) {
    return this.setProperty(deviceMac, deviceModel, PIDs.POWER_LOSS_RECOVERY, String(mode));
  },

  /**
   * Disable bulb away mode. P1506 = "0". The enable path needs an
   * undocumented switch_rule generator and is deliberately not implemented.
   */
  async setBulbAwayModeOff(deviceMac, deviceModel) {
    return this.setProperty(deviceMac, deviceModel, PIDs.AWAY_MODE, "0");
  },

  // ---- Light strip visual effects ------------------------------------------

  /**
   * Build the prop-list payload for a light-strip visual effect.
   */
  buildLightVisualEffect(options) {
    const { model } = options;
    if (!Object.values(LightVisualEffectModel).includes(model)) {
      throw new Error(`buildLightVisualEffect: invalid model ${JSON.stringify(model)}`);
    }
    const runType = options.runType ?? null;
    if (runType !== null && !Object.values(LightVisualEffectRunType).includes(runType)) {
      throw new Error(`buildLightVisualEffect: invalid runType ${JSON.stringify(runType)}`);
    }
    const speed = options.speed ?? 8;
    if (!Number.isInteger(speed) || speed < 1 || speed > 10) {
      throw new Error("buildLightVisualEffect: speed must be an integer 1-10");
    }
    const sensitivity = options.sensitivity ?? 100;
    if (!Number.isInteger(sensitivity) || sensitivity < 0 || sensitivity > 100) {
      throw new Error("buildLightVisualEffect: sensitivity must be 0-100");
    }
    const plist = [
      { pid: PIDs.LAMP_WITH_MUSIC_MODE, pvalue: model },
      { pid: PIDs.MUSIC_MODE, pvalue: options.musicMode ? "1" : "0" },
      { pid: PIDs.LIGHT_STRIP_SPEED, pvalue: String(speed) },
      { pid: PIDs.LAMP_WITH_MUSIC_MUSIC, pvalue: String(sensitivity) },
      { pid: PIDs.LAMP_WITH_MUSIC_RHYTHM, pvalue: options.rhythm ?? "0" },
      { pid: PIDs.LAMP_WITH_MUSIC_AUTO_COLOR, pvalue: options.autoColor ? "1" : "0" },
      { pid: PIDs.LAMP_WITH_MUSIC_COLOR, pvalue: options.colorPalette ?? "2961AF,B5267A,91FF6A" },
    ];
    if (runType !== null && LightVisualEffectModelsWithDirection.includes(model)) {
      plist.push({ pid: PIDs.LAMP_WITH_MUSIC_TYPE, pvalue: runType });
    }
    return plist;
  },

  /**
   * Apply a visual effect to a light strip. Writes the effect plist plus
   * a flip of P1508 → FRAGMENTED so the strip enters scene mode.
   */
  async setBulbEffect(deviceMac, deviceModel, effectOptions) {
    if (!DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
      throw new Error(`setBulbEffect: ${deviceModel} is not a light strip`);
    }
    const plist = this.buildLightVisualEffect(effectOptions);
    plist.push({
      pid: PIDs.CONTROL_LIGHT,
      pvalue: String(LightControlMode.FRAGMENTED),
    });
    return this.runActionListMulti(deviceMac, deviceModel, plist, "set_mesh_property");
  },

  // ---- Color setters -------------------------------------------------------

  /**
   * Set a color. Behavior depends on the model:
   *   - Mesh color bulb (WLPA19C): writes P1507.
   *   - Light Strip (HL_LSL): P1507 + flips P1508 → COLOR.
   *   - Light Strip Pro (HL_LSLP):
   *       - string `hex` → replicates to all 16 subsections (P1515) + P1508.
   *       - array of 16 → uses each per-subsection color.
   *
   * @param {string|string[]} hex — `"FF5733"` or array of 16 HEX strings.
   */
  async setBulbColor(deviceMac, deviceModel, hex) {
    if (!DeviceModels.MESH_BULB.includes(deviceModel)) {
      throw new Error(`setBulbColor: ${deviceModel} does not support color`);
    }
    const isPro = DeviceModels.LIGHT_STRIP_PRO.includes(deviceModel);
    const isStrip = DeviceModels.LIGHT_STRIP.includes(deviceModel);

    const validateHex = (v) => {
      if (typeof v !== "string" || !/^[0-9a-fA-F]{6}$/.test(v)) {
        throw new Error(`setBulbColor: ${JSON.stringify(v)} is not a 6-char HEX color`);
      }
    };

    if (Array.isArray(hex)) {
      if (!isPro) {
        throw new Error(
          "setBulbColor: per-subsection color arrays are only supported on Light Strip Pro"
        );
      }
      if (hex.length !== 16) {
        throw new Error("setBulbColor: Light Strip Pro requires exactly 16 colors");
      }
      hex.forEach(validateHex);
      const colors = hex.map((c) => c.toUpperCase());
      const subsectionValue = "00" + colors.join("#00");
      return this.runActionListMulti(
        deviceMac,
        deviceModel,
        [
          { pid: PIDs.LIGHTSTRIP_PRO_SUBSECTION, pvalue: subsectionValue },
          { pid: PIDs.CONTROL_LIGHT, pvalue: String(LightControlMode.COLOR) },
        ],
        "set_mesh_property"
      );
    }

    validateHex(hex);
    const color = hex.toUpperCase();

    if (isPro) {
      const subsectionValue = "00" + Array(16).fill(color).join("#00");
      return this.runActionListMulti(
        deviceMac,
        deviceModel,
        [
          { pid: PIDs.LIGHTSTRIP_PRO_SUBSECTION, pvalue: subsectionValue },
          { pid: PIDs.CONTROL_LIGHT, pvalue: String(LightControlMode.COLOR) },
        ],
        "set_mesh_property"
      );
    }

    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, color, "set_mesh_property");
    if (isStrip) {
      await this.runActionList(
        deviceMac,
        deviceModel,
        PIDs.CONTROL_LIGHT,
        LightControlMode.COLOR,
        "set_mesh_property"
      );
    }
  },

  /**
   * Strip-aware color temperature. Writes P1502; for light strips also
   * flips P1508 → TEMPERATURE so a strip in COLOR/FRAGMENTED switches
   * to white-CCT.
   */
  async setBulbColorTemperature(deviceMac, deviceModel, value) {
    if (DeviceModels.MESH_BULB.includes(deviceModel)) {
      await this.runActionList(deviceMac, deviceModel, PIDs.COLOR_TEMP, value, "set_mesh_property");
      if (DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
        await this.runActionList(
          deviceMac,
          deviceModel,
          PIDs.CONTROL_LIGHT,
          LightControlMode.TEMPERATURE,
          "set_mesh_property"
        );
      }
      return;
    }
    return this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
  },

  // ---- Mesh bulb / light strip basic controls ------------------------------

  async lightMeshPower(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, value, "set_mesh_property");
  },

  async lightMeshOn(deviceMac, deviceModel) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, "1", "set_mesh_property");
  },

  async lightMeshOff(deviceMac, deviceModel) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, "0", "set_mesh_property");
  },

  async setMeshBrightness(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.BRIGHTNESS, value, "set_mesh_property");
  },

  async setMeshColorTemperature(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR_TEMP, value, "set_mesh_property");
  },

  async setMeshHue(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, value, "set_mesh_property");
  },

  async setMeshSaturation(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, value, "set_mesh_property");
  },

};
