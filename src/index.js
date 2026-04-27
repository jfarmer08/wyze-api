//v0.1.1.8 Update on new releases

const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const getUuid = require("uuid-by-string");
const nodeCrypto = require("crypto");

const payloadFactory = require("./payloadFactory");
const crypto = require("./crypto");
const constants = require("./constants");
const util = require("./util");
const RokuAuthLib = require("./rokuAuth")
const cameraStreamCapture = require("./cameraStreamCapture");
const types = require("./types");

const {
  VacuumControlType,
  VacuumControlValue,
  VacuumPreferenceType,
  propertyIds: PIDs,
  propertyValues: PVals,
} = types;

module.exports = class WyzeAPI {
  constructor(options) {
    const Logger = require("@ptkdev/logger");
    this.log = new Logger();
    this.persistPath = options.persistPath;
    this.refreshTokenTimerEnabled = options.refreshTokenTimerEnabled || false;
    this.lowBatteryPercentage = options.lowBatteryPercentage || 30;
    // User login parameters
    this.username = options.username;
    this.password = options.password;
    this.mfaCode = options.mfaCode;
    this.apiKey = options.apiKey;
    this.keyId = options.keyId;

    // Logging
    this.apiLogEnabled = options.apiLogEnabled;

    // URLs
    this.authBaseUrl = options.authBaseUrl || constants.authBaseUrl;
    this.apiBaseUrl =
      options.apiBaseUrl || options.baseUrl || constants.apiBaseUrl;

    // App emulation constants
    this.authApiKey = options.authApiKey || constants.authApiKey;
    this.phoneId = options.phoneId || constants.phoneId;
    this.appName = options.appName || constants.appName;
    this.appVer = options.appVer || constants.appVer;
    this.appVersion = options.appVersion || constants.appVersion;
    this.userAgent = options.userAgent || constants.userAgent;
    this.sc = options.sc || constants.sc;
    this.sv = options.sv || constants.sv;

    // Crypto Secrets
    this.fordAppKey = options.fordAppKey || constants.fordAppKey; // Required for Locks
    this.fordAppSecret = options.fordAppSecret || constants.fordAppSecret; // Required for Locks
    this.oliveSigningSecret =
      options.oliveSigningSecret || constants.oliveSigningSecret; // Required for the thermostat
    this.oliveAppId = options.oliveAppId || constants.oliveAppId; //  Required for the thermostat
    this.appInfo = options.appInfo || constants.appInfo; // Required for the thermostat

    // Login tokens
    this.access_token = "";
    this.refresh_token = "";

    this.dumpData = false; // Set this to true to log the Wyze object data blob one time at startup.

    this.lastLoginAttempt = 0;
    this.loginAttemptDebounceMilliseconds = 1000;

    // Token is good for 216,000 seconds (60 hours) but 48 hours seems like a reasonable refresh interval 172800
    if (this.refreshTokenTimerEnabled === true) {
      setInterval(this.refreshToken.bind(this), 172800);
    }
  }

  getRequestData(data = {}) {
    return {
      access_token: this.access_token,
      app_name: this.appName,
      app_ver: this.appVer,
      app_version: this.appVersion,
      phone_id: this.phoneId,
      phone_system_type: "1",
      sc: this.sc,
      sv: this.sv,
      ts: new Date().getTime(),
      ...data,
    };
  }

  /**
   * Sends an HTTP request to the specified URL with the provided data.
   * Handles automatic retries in case of specific errors, such as a retry-after condition.
   *
   * @param {string} url - The URL to send the request to.
   * @param {object} [data={}] - The data to be sent with the request (default is an empty object).
   * @returns {Promise<Response>} - The response from the server if successful.
   * @throws {Error} - Throws an error if the request fails after a retry or encounters an unknown error.
   */
  async request(url, data = {}) {
    // Ensure the user is logged in before making the request.
    await this.maybeLogin();

    // Perform the initial request and handle errors.
    return this._handleRequest(url, data);
  }

  /**
  * Handles the request process, including retry logic for specific errors.
  *
  * @param {string} url - The URL to send the request to.
  * @param {object} data - The data to be sent with the request.
  * @returns {Promise<Response>} - The response from the server if successful.
  * @throws {Error} - Throws an error if the request fails after a retry or encounters an unknown error.
  */
  async _handleRequest(url, data) {
    let response = await this._performRequest(url, this.getRequestData(data));

    // If the request is successful, return the response.
    if (response.ok) {
      return response;
    }

    // If a retryAfter error occurs, handle the retry logic.
    if (response.error?.retryAfter) {
      return this._handleRetry(url, data, response.error);
    }

    // Handle any other errors by throwing an appropriate error message.
    throw new Error(`Request Failed: ${response.error?.message || "Unknown Error"}`);
  }

  /**
  * Handles the retry logic if the request fails due to a retryAfter error.
  *
  * @param {string} url - The URL to send the request to.
  * @param {object} data - The data to be sent with the request.
  * @param {object} error - The error object containing retryAfter information.
  * @returns {Promise<Response>} - The response from the server if successful after retrying.
  * @throws {Error} - Throws an error if the request fails after a retry.
  */
  async _handleRetry(url, data, error) {
    this.log.error(`Error: ${error.message}. Retrying after ${new Date(error.retryAfter)}`);

    // Calculate the time to wait before retrying the request.
    const retryAfterMs = error.retryAfter - new Date().getTime();
    if (retryAfterMs > 0) {
      this.log.info(`Waiting for ${retryAfterMs}ms before retrying`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }

    // Attempt to log in again before retrying the request.
    await this.maybeLogin();

    // Retry the request.
    const response = await this._performRequest(url, this.getRequestData(data));

    // If the retry is successful, return the response.
    if (response.ok) return response;

    // If the retry fails, throw an error with the failure message.
    throw new Error(`Error: ${response.error?.message || "Request Failed After Retry"}`);
  }

  async _performRequest(url, data = {}, config = {}) {
    // Prepare the request configuration
    config = {
      method: "POST",
      url,
      data,
      baseURL: this.apiBaseUrl,
      ...config,
    };

    // Log the request if API logging is enabled
    if (this.apiLogEnabled) {
      this.log.info(`Performing request: ${JSON.stringify(config)}`);
    }

    let result;
    try {
      result = await axios(config);
    } catch (err) {
      this._handleRequestError(err, url);
      throw err;
    }

    // Handle logging of response data
    this._logApiResponse(result, url);

    // Check and handle API rate limiting
    await this._checkRateLimit(result.headers);

    // Handle API errors based on the response code
    return this._handleApiResponse(result, url, data);
  }

  _handleRequestError(err, url) {
    if (err.response) {
      this.log.error(
        `Request Failed: ${JSON.stringify({
          url,
          status: err.response.status,
          data: err.response.data,
          headers: err.response.headers,
        })}`
      );
    } else {
      this.log.error(
        `Request Failed: ${JSON.stringify({
          url,
          message: err.message,
        })}`
      );
    }
  }

  _logApiResponse(result, url) {
    if (this.dumpData) {
      this.dumpData = false;
      this.log.info(
        `API response PerformRequest: ${JSON.stringify(
          result.data,
          (key, val) => (key.includes("token") ? "*******" : val)
        )}`
      );
    } else if (this.apiLogEnabled) {
      this.log.info(
        `API response PerformRequest: ${JSON.stringify({
          url,
          status: result.status,
          data: result.data,
          headers: result.headers,
        })}`
      );
    }
  }

  async _checkRateLimit(headers) {
    try {
      const rateLimitRemaining = headers["x-ratelimit-remaining"]
        ? Number(headers["x-ratelimit-remaining"])
        : undefined;

      const rateLimitResetBy = headers["x-ratelimit-reset-by"]
        ? new Date(headers["x-ratelimit-reset-by"]).getTime()
        : undefined;

      if (rateLimitRemaining !== undefined && rateLimitRemaining < 7) {
        const resetsIn = rateLimitResetBy - Date.now();
        this.log.info(
          `API rate limit remaining: ${rateLimitRemaining} - resets in ${resetsIn}ms`
        );
        await this.sleepMilliSecounds(resetsIn);
      } else if (rateLimitRemaining && this.apiLogEnabled) {
        this.log.info(
          `API rate limit remaining: ${rateLimitRemaining}. Expires in ${rateLimitResetBy - Date.now()}ms`
        );
      }
    } catch (err) {
      this.log.error(`Error checking rate limit: ${err}`);
    }
  }

  _handleApiResponse(result, url, data) {
    const { code, msg, description } = result.data;
    const errorMessage = msg || description || "Unknown Wyze API Error";

    if (typeof code !== "undefined" && Number(code) !== 1) {
      this.log.error(`Wyze API Error (${code}): '${errorMessage}'`);

      if (this._isInvalidCredentialsError(errorMessage)) {
        this.access_token = "";
        throw new Error(
          `Invalid Credentials - please check your credentials & account before trying again. Error: ${errorMessage}`
        );
      }

      if (this._isRateLimitError(code, errorMessage)) {
        return this._handleRateLimitError(result, errorMessage, code);
      }

      if (this._isAccessTokenError(code, errorMessage)) {
        return this._handleAccessTokenError(result, errorMessage, code, url, data);
      }

      if (this._isBadRequestError(code)) {
        throw new Error(
          `Wyze API Bad Request: Check your request parameters - ${JSON.stringify(
            { code, message: errorMessage, url, requestBody: data }
          )}`
        );
      }

      throw new Error(`Wyze API Error (${code}) - ${errorMessage}`);
    }

    return { ...result, ok: true, data: result.data };
  }

  _isInvalidCredentialsError(errorMessage) {
    const invalidMessages = [
      "UserNameOrPasswordError",
      "UserIsLocked",
      "Invalid User Name or Password",
    ];
    return invalidMessages.some((msg) =>
      errorMessage.toLowerCase().includes(msg.toLowerCase())
    );
  }

  _isRateLimitError(code, errorMessage) {
    return (
      code === 3044 ||
      (code === 1000 &&
        errorMessage.toLowerCase().includes("too many failed attempts"))
    );
  }

  _handleRateLimitError(result, errorMessage, code) {
    return {
      ...result,
      ok: false,
      data: result.data,
      error: {
        retryAfter: Date.now() + 600_000, // 10 minutes from now
        message: `Rate Limited - please wait before trying again. Error: ${errorMessage}`,
        code,
      },
    };
  }

  _isAccessTokenError(code, errorMessage) {
    return (
      code === 2001 ||
      errorMessage.toLowerCase().includes("accesstokenerror") ||
      errorMessage.toLowerCase().includes("access token is error")
    );
  }

  async _handleAccessTokenError(result, errorMessage, code, url, data) {
    this.access_token = "";
    await this.refreshToken().catch((err) => {
      throw new Error(
        `Refresh Token could not be used to get a new access token. ${err}`
      );
    });

    return {
      ...result,
      ok: false,
      data: result.data,
      error: {
        retryAfter: this.access_token ? Date.now() : 0,
        message: this.access_token
          ? `Access Token had expired and a new one was obtained. Please retry your request.`
          : `Access Token Error - please refresh your access token. Error: ${errorMessage}`,
        code,
      },
    };
  }

  _isBadRequestError(code) {
    return [1001, 1004].includes(code);
  }

  _performLoginRequest(data = {}) {
    let url = "api/user/login";
    data = {
      email: this.username,
      password: util.createPassword(this.password),
      ...data,
    };

    const config = {
      baseURL: this.authBaseUrl,
      headers: {
        "x-api-key": this.authApiKey,
        apikey: this.apiKey,
        keyid: this.keyId,
        "User-Agent": this.userAgent,
      },
    };

    return this._performRequest(url, data, config);
  }

  async login() {
    // Wyze requires 2 sets of credentials to login + MFA - username/password, apiKey/keyId
    if (this.apiKey == null) {
      throw new Error(
        'ApiKey Required, Please provide the "apiKey" parameter in config.json'
      );
    } else if (this.keyId == null) {
      throw new Error(
        'KeyId Required, Please provide the "keyId" parameter in config.json'
      );
    } else {
      const result = await this._performLoginRequest();
      if (!result.ok || !result.data.access_token) {
        throw new Error(
          `Invalid credentials, please check username/password, keyId/apiKey - ${JSON.stringify(
            result
          )}`
        );
      }
      if (this.apiLogEnabled) {
        this.log.info("Successfully logged into Wyze API");
      }
      await this._updateTokens(result.data);
    }
  }

  /**
   * Ensures that the user is logged in by checking and managing the access token.
   * If the access token is missing or expired, it handles the login process,
   * considering debounce settings to avoid multiple login attempts.
   */
  async maybeLogin() {
    // Check if the access token is available.
    if (!this.access_token) {
      await this._loadPersistedTokens(); // Load any previously saved tokens.
    }

    // If the access token is still not available, proceed with login logic.
    if (this.access_token) {
      return; // Token is available, no need to log in.
    }

    const now = Date.now(); // Get the current time.
    this.logDebounceInfo(now); // Log debounce information for debugging purposes.

    // Check if the debounce period has expired.
    if (this.isDebounceCleared(now)) {
      this.resetDebounceIfNeeded(now); // Reset debounce settings if necessary.
      await this.tryLogin(now); // Attempt to log in.
    } else {
      // Wait for the debounce period to expire before retrying login.
      await this.waitForDebounceClearance(now);

      // If the access token is still not available after waiting,
      // update debounce settings and try logging in again.
      if (!this.access_token) {
        this.updateDebounceAndLogin(now);
      }
    }
  }

  /**
  * Logs information about the current debounce state.
  * @param {number} now - The current time in milliseconds.
  */
  logDebounceInfo(now) {
    if (this.apiLogEnabled) {
      this.log.info(
        `Last login: ${this.lastLoginAttempt}, Debounce: ${this.loginAttemptDebounceMilliseconds} ms, Now: ${now}`
      );
    }
  }

  /**
  * Checks if the debounce period has expired.
  * @param {number} now - The current time in milliseconds.
  * @returns {boolean} - True if the debounce period has expired, false otherwise.
  */
  isDebounceCleared(now) {
    return (this.lastLoginAttempt + this.loginAttemptDebounceMilliseconds) < now;
  }

  /**
  * Resets the debounce settings if needed.
  * @param {number} now - The current time in milliseconds.
  */
  resetDebounceIfNeeded(now) {
    const debounceThreshold = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    if (now - this.lastLoginAttempt > debounceThreshold) {
      this.loginAttemptDebounceMilliseconds = 1000; // Reset to 1 second
    }
  }

  /**
  * Attempts to perform the login process.
  * @param {number} now - The current time in milliseconds.
  */
  async tryLogin(now) {
    this.lastLoginAttempt = now; // Update the last login attempt time.
    await this.login(); // Perform the login.
  }

  /**
  * Waits for the debounce period to expire before retrying login.
  * @param {number} now - The current time in milliseconds.
  */
  async waitForDebounceClearance(now) {
    this.log.info(
      `Attempting to login before debounce has cleared, waiting ${this.loginAttemptDebounceMilliseconds / 1000} seconds`
    );

    let waitTime = 0;
    while (waitTime < this.loginAttemptDebounceMilliseconds) {
      await this.sleepSeconds(2); // Wait for 2 seconds.
      waitTime += 2000;
      if (this.access_token) {
        return; // Exit if access token becomes available.
      }
    }
  }

  /**
  * Updates debounce settings and attempts to log in again.
  * @param {number} now - The current time in milliseconds.
  */
  async updateDebounceAndLogin(now) {
    this.lastLoginAttempt = now; // Update the last login attempt time.
    this.loginAttemptDebounceMilliseconds = Math.min(
      this.loginAttemptDebounceMilliseconds * 2, // Double the debounce time.
      5 * 60 * 1000 // Cap the debounce time to 5 minutes.
    );
    await this.login(); // Perform the login.
  }

  /**
   * Refreshes the access token using the refresh token.
   * If successful, updates and persists the new tokens.
   * @throws {Error} - Throws an error if the refresh token request fails or if the response is invalid.
   */
  async refreshToken() {
    const data = {
      ...this.getRequestData(),
      refresh_token: this.refresh_token,
    };

    const maxRetries = 2; // One initial attempt + one retry
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        // Perform the token refresh request.
        const result = await this._performRequest("app/user/refresh_token", data);

        // Validate the response structure.
        if (result.ok && result.data?.data) {
          // Update and persist the new tokens.
          await this._updateTokens(result.data.data);
          return; // Exit if successful.
        } else {
          throw new Error(
            `Failed to refresh access token - ${JSON.stringify(result)}`
          );
        }
      } catch (error) {
        attempt += 1;
        if (attempt < maxRetries) {
          this.log.info(`Retrying token refresh, attempt ${attempt}...`);
          // Wait before retrying
          await this.sleepSeconds(2); // Sleep for 2 seconds before retrying
        } else {
          this.log.error(`Error during token refresh: ${error.message}`);
          throw new Error(`Token refresh failed: ${error.message}`);
        }
      }
    }
  }

  /**
  * Updates the access and refresh tokens with new values.
  * @param {object} tokens - Object containing new access and refresh tokens.
  * @param {string} tokens.access_token - The new access token.
  * @param {string} tokens.refresh_token - The new refresh token.
  * @throws {Error} - Throws an error if token persistence fails.
  */
  async _updateTokens({ access_token, refresh_token }) {
    try {
      // Update the current tokens.
      this.access_token = access_token;
      this.refresh_token = refresh_token;

      // Persist the updated tokens to storage.
      await this._persistTokens();
    } catch (error) {
      // Handle errors during token persistence.
      this.log.error(`Error updating tokens: ${error.message}`);
      throw new Error(`Failed to update tokens: ${error.message}`);
    }
  }

  /**
  * Constructs the file path for storing tokens.
  * @returns {string} - The file path where tokens are stored.
  */
  _tokenPersistPath() {
    const uuid = getUuid(this.username); // Generate a unique identifier based on the username.
    if (!uuid) {
      throw new Error("Failed to generate UUID for token persistence path.");
    }
    return path.join(this.persistPath, `wyze-${uuid}.json`); // Construct the file path.
  }

  /**
  * Persists the current access and refresh tokens to a file.
  * @throws {Error} - Throws an error if file writing fails.
  */
  async _persistTokens() {
    const data = {
      access_token: this.access_token,
      refresh_token: this.refresh_token,
    };
    const tokenPath = this._tokenPersistPath(); // Get the file path for tokens.

    const maxRetries = 2; // One initial attempt + one retry
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        if (this.apiLogEnabled) {
          this.log.info(`Persisting tokens @ ${tokenPath}`);
        }
        await fs.writeFile(tokenPath, JSON.stringify(data)); // Write tokens to the file.
        return; // Exit if successful.
      } catch (error) {
        attempt += 1;
        if (attempt < maxRetries) {
          this.log.info(`Retrying token persistence, attempt ${attempt}...`);
          // Wait before retrying
          await this.sleepSeconds(2); // Sleep for 2 seconds before retrying
        } else {
          this.log.error(`Error persisting tokens: ${error.message}`);
          throw new Error(`Failed to persist tokens: ${error.message}`);
        }
      }
    }
  }

  /**
  * Loads persisted tokens from storage and updates the current tokens.
  * Logs a message if no tokens are found.
  * @throws {Error} - Throws an error if file reading or data parsing fails.
  */
  async _loadPersistedTokens() {
    const tokenPath = this._tokenPersistPath(); // Get the file path for tokens.

    try {
      const data = await fs.readFile(tokenPath); // Read the token file.
      const parsedData = JSON.parse(data); // Parse the token data.

      // Validate the token data structure.
      if (parsedData.access_token && parsedData.refresh_token) {
        this.access_token = parsedData.access_token;
        this.refresh_token = parsedData.refresh_token;
      } else {
        throw new Error("Persisted tokens are invalid.");
      }
    } catch (error) {
      // Handle errors such as file not found or JSON parsing errors.
      if (this.apiLogEnabled) {
        this.log.error(`Error loading persisted tokens: ${error.message}`);
      }

      // Consider implementing a fallback or recovery strategy here.
    }
  }

  async getObjectList() {
    const result = await this.request("app/v2/home_page/get_object_list");
    return result.data;
  }

  async getPropertyList(deviceMac, deviceModel) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
    };

    const result = await this.request("app/v2/device/get_property_list", data);
    return result.data;
  }

  async setProperty(deviceMac, deviceModel, propertyId, propertyValue) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
      pid: propertyId,
      pvalue: propertyValue,
    };

    const result = await this.request("app/v2/device/set_property", data);
    return result.data;
  }

  /**
   * Set multiple properties on a device in one call.
   * Wraps `app/v2/device/set_property_list`. Some props (e.g. mesh-bulb
   * sun_match) require this endpoint instead of the singular set_property.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Array<{pid: string, pvalue: string|number|boolean}>} plist
   */
  async setPropertyList(deviceMac, deviceModel, plist) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
      property_list: plist.map((p) => ({
        pid: p.pid,
        pvalue: typeof p.pvalue === "string" ? p.pvalue : String(p.pvalue),
      })),
    };
    const result = await this.request("app/v2/device/set_property_list", data);
    return result.data;
  }

  // Generic device-side timer primitives. Wyze devices (plugs, bulbs, lights,
  // wall switches) support a server-tracked timer that flips the device on
  // or off after a delay. action_type=1 corresponds to the on/off action.

  /**
   * Set a delayed on/off timer on a device.
   * @param {string} deviceMac
   * @param {number} delaySeconds
   * @param {number} actionValue — 1 to turn on, 0 to turn off, after the delay
   */
  async setDeviceTimer(deviceMac, delaySeconds, actionValue) {
    const data = {
      device_mac: deviceMac,
      action_type: 1,
      action_value: actionValue,
      delay_time: delaySeconds,
      plan_execute_ts: Date.now() + delaySeconds * 1000,
    };
    const result = await this.request("app/v2/device/timer/set", data);
    return result.data;
  }

  /**
   * Read the active on/off timer for a device, if any.
   */
  async getDeviceTimer(deviceMac, actionType = 1) {
    const data = { device_mac: deviceMac, action_type: actionType };
    const result = await this.request("app/v2/device/timer/get", data);
    return result.data;
  }

  /**
   * Cancel any pending on/off timer for a device.
   */
  async cancelDeviceTimer(deviceMac, actionType = 1) {
    const data = { device_mac: deviceMac, action_type: actionType };
    const result = await this.request("app/v2/device/timer/cancel", data);
    return result.data;
  }

  async runAction(deviceMac, deviceModel, actionKey) {
    const data = {
      instance_id: deviceMac,
      provider_key: deviceModel,
      action_key: actionKey,
      action_params: {},
      custom_string: "",
    };

    if (this.apiLogEnabled)
      this.log.info(`run_action Data Body: ${JSON.stringify(data)}`);

    const result = await this.request("app/v2/auto/run_action", data);
    return result.data;
  }

  async runActionList(deviceMac, deviceModel, propertyId, propertyValue, actionKey) {
    const plist = [
      { pid: propertyId, pvalue: String(propertyValue) }
    ];

    // Add default on/off property if not already the on/off PID
    if (propertyId !== PIDs.ON) {
      plist.push({ pid: PIDs.ON, pvalue: "1" });
    }

    const data = {
      action_list: [
        {
          instance_id: deviceMac,
          action_params: {
            list: [{ mac: deviceMac, plist }]
          },
          provider_key: deviceModel,
          action_key: actionKey
        }
      ]
    };

    if (this.apiLogEnabled) {
      this.log.info(`runActionList Request Data: ${JSON.stringify(data)}`);
    }

    const result = await this.request("app/v2/auto/run_action_list", data);
    return result.data;
  }

  /**
   * Like `runActionList`, but accepts an array of `{pid, pvalue}` props in
   * a single action — needed when one action must atomically set several
   * properties (e.g. light-strip visual effects). Does NOT auto-push the
   * on/off prop; caller controls the full plist.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Array<{pid: string, pvalue: string|number|boolean}>} plist
   * @param {string} actionKey
   */
  async runActionListMulti(deviceMac, deviceModel, plist, actionKey) {
    const normalizedPlist = plist.map((p) => ({
      pid: p.pid,
      pvalue: typeof p.pvalue === "string" ? p.pvalue : String(p.pvalue),
    }));
    const data = {
      action_list: [
        {
          instance_id: deviceMac,
          action_params: {
            list: [{ mac: deviceMac, plist: normalizedPlist }],
          },
          provider_key: deviceModel,
          action_key: actionKey,
        },
      ],
    };
    if (this.apiLogEnabled) {
      this.log.info(`runActionListMulti Request Data: ${JSON.stringify(data)}`);
    }
    const result = await this.request("app/v2/auto/run_action_list", data);
    return result.data;
  }

  async controlLock(deviceMac, deviceModel, action) {
    return this._fordPost("/openapi/lock/v1/control", {
      uuid: this.getUuid(deviceMac, deviceModel),
      action, // "remoteLock" or "remoteUnlock"
    });
  }

  async getLockInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/lock/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
      with_keypad: "1",
    });
  }

  async getIotProp(deviceMac) {
    const keys = "iot_state,switch-power,switch-iot,single_press_type,double_press_type,triple_press_type,long_press_type,palm-state";
    const payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    return this._oliveSignedGet(
      "https://wyze-sirius-service.wyzecam.com/plugin/sirius/get_iot_prop",
      payload,
      "GetIotProp"
    );
  }

  async setIotProp(deviceMac, product_model, propKey, value) {
    const payload = payloadFactory.oliveCreatePostPayload(deviceMac, product_model, propKey, value);
    return this._oliveSignedPost(
      "https://wyze-sirius-service.wyzecam.com/plugin/sirius/set_iot_prop_by_topic",
      payload,
      "SetIotProp"
    );
  }

  async getUserProfile() {
    const payload = payloadFactory.oliveCreateUserInfoPayload();
    return this._oliveSignedGet(
      "https://wyze-platform-service.wyzecam.com/app/v2/platform/get_user_profile",
      payload,
      "GetUserProfile"
    );
  }

  async disableRemeAlarm(hms_id) {
    return this._hmsRequest("delete", "https://hms.api.wyze.com/api/v1/reme-alarm", {
      body: { hms_id, remediation_id: "emergency" },
      label: "DisableRemeAlarm",
    });
  }

  async getPlanBindingListByUser() {
    const payload = payloadFactory.oliveCreateHmsPayload();
    return this._oliveSignedGet(
      "https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user",
      payload,
      "GetPlanBindingListByUser"
    );
  }

  async monitoringProfileStateStatus(hms_id) {
    const params = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    return this._hmsRequest(
      "get",
      "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status",
      { params, sign: true, contentType: true, label: "MonitoringProfileStateStatus" }
    );
  }

  async monitoringProfileActive(hms_id, home, away) {
    const params = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const body = [
      { state: "home", active: home },
      { state: "away", active: away },
    ];
    return this._hmsRequest(
      "patch",
      "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/active",
      { params, body, sign: true, label: "MonitoringProfileActive" }
    );
  }

  async thermostatGetIotProp(deviceMac) {
    const keys =
      "trigger_off_val,emheat,temperature,humidity,time2temp_val,protect_time,mode_sys,heat_sp,cool_sp, current_scenario,config_scenario,temp_unit,fan_mode,iot_state,w_city_id,w_lat,w_lon,working_state, dev_hold,dev_holdtime,asw_hold,app_version,setup_state,wiring_logic_id,save_comfort_balance, kid_lock,calibrate_humidity,calibrate_temperature,fancirc_time,query_schedule";
    const payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    return this._earthGet("/plugin/earth/get_iot_prop", payload);
  }

  async thermostatSetIotProp(deviceMac, deviceModel, propKey, value) {
    const payload = payloadFactory.oliveCreatePostPayload(deviceMac, deviceModel, propKey, value);
    return this._earthPost("/plugin/earth/set_iot_prop_by_topic", payload);
  }

  // Default key sets for Earth-service reads. Mirrors what the thermostat
  // app reads at home-screen render time.
  static get THERMOSTAT_DEVICE_INFO_KEYS() {
    return ["device_id", "device_type", "model", "mac", "firmware_ver", "main_device", "ip", "ssid"];
  }

  static get ROOM_SENSOR_PROP_KEYS() {
    return ["temperature", "humidity", "battery", "rssi", "iot_state"];
  }

  /**
   * Read device-level info for a thermostat (firmware, MAC, IP, SSID, etc.).
   * @param {string} deviceMac
   * @param {string|string[]} [keys] — defaults to a sensible set of device fields
   */
  async getThermostatDeviceInfo(deviceMac, keys = WyzeAPI.THERMOSTAT_DEVICE_INFO_KEYS) {
    const params = {
      device_id: deviceMac,
      keys: Array.isArray(keys) ? keys.join(",") : keys,
    };
    return this._earthGet("/plugin/earth/device_info", params);
  }

  /**
   * List the room sensors (CO_TH1) paired with a thermostat.
   * @param {string} deviceMac
   */
  async getThermostatSensors(deviceMac) {
    return this._earthGet("/plugin/earth/get_sub_device", { device_id: deviceMac });
  }

  /**
   * Combined snapshot of a thermostat — list entry + IoT props + device
   * info. Tolerates a missing sub-fetch (logs a warning, returns what's
   * available).
   *
   * @param {string} mac
   * @returns {Promise<Object|null>}
   */
  async getThermostatInfo(mac) {
    const devices = await this.getDeviceList();
    const tstat = devices.find(
      (d) => d.mac === mac && types.DeviceModels.THERMOSTAT.includes(d.product_model)
    );
    if (!tstat) return null;

    const result = { ...tstat };

    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        this.log.warning(`getThermostatInfo: ${label} failed: ${err.message}`);
        return null;
      }
    };

    const iot = await safe("iot_prop", () => this.thermostatGetIotProp(tstat.mac));
    if (iot?.data?.props) Object.assign(result, iot.data.props);

    const info = await safe("device_info", () => this.getThermostatDeviceInfo(tstat.mac));
    if (info?.data?.settings) Object.assign(result, info.data.settings);

    return result;
  }

  // Thermostat typed setters — thin wrappers around thermostatSetIotProp
  // that constrain values to the valid set. Each is a single prop write
  // unless noted (setThermostatTemperature / holdThermostat / clearThermostatHold
  // do two writes).

  _validateOneOf(value, allowed, label) {
    const list = Object.values(allowed);
    if (!list.includes(value)) {
      throw new Error(
        `${label}: ${JSON.stringify(value)} is not a valid value (expected one of ${list.map((v) => JSON.stringify(v)).join(", ")})`
      );
    }
  }

  /**
   * Set the system mode — one of `auto`, `cool`, `heat`, `off`.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {string} mode — see `WyzeAPI.ThermostatSystemMode`
   */
  async setThermostatSystemMode(deviceMac, deviceModel, mode) {
    this._validateOneOf(mode, types.ThermostatSystemMode, "setThermostatSystemMode");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "mode_sys", mode);
  }

  /**
   * Set the fan mode — `auto`, `circ`, or `on`.
   */
  async setThermostatFanMode(deviceMac, deviceModel, mode) {
    this._validateOneOf(mode, types.ThermostatFanMode, "setThermostatFanMode");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "fan_mode", mode);
  }

  /**
   * Set the active scenario — `home`, `away`, or `sleep`.
   */
  async setThermostatScenario(deviceMac, deviceModel, scenario) {
    this._validateOneOf(scenario, types.ThermostatScenarioType, "setThermostatScenario");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "current_scenario", scenario);
  }

  /**
   * Set the heating setpoint. Wyze stores setpoints as tenths of a degree
   * Fahrenheit (e.g. `680` = 68.0°F) regardless of the user's display unit.
   * @param {number} value — integer tenths-of-°F
   */
  async setThermostatHeatingSetpoint(deviceMac, deviceModel, value) {
    if (!Number.isInteger(value)) {
      throw new Error("setThermostatHeatingSetpoint: value must be an integer (tenths of °F)");
    }
    return this.thermostatSetIotProp(deviceMac, deviceModel, "heat_sp", value);
  }

  /**
   * Set the cooling setpoint (tenths of °F).
   */
  async setThermostatCoolingSetpoint(deviceMac, deviceModel, value) {
    if (!Number.isInteger(value)) {
      throw new Error("setThermostatCoolingSetpoint: value must be an integer (tenths of °F)");
    }
    return this.thermostatSetIotProp(deviceMac, deviceModel, "cool_sp", value);
  }

  /**
   * Set both setpoints in one call (sequential writes).
   */
  async setThermostatTemperature(deviceMac, deviceModel, coolingSetpoint, heatingSetpoint) {
    await this.setThermostatCoolingSetpoint(deviceMac, deviceModel, coolingSetpoint);
    await this.setThermostatHeatingSetpoint(deviceMac, deviceModel, heatingSetpoint);
  }

  /**
   * Toggle the child-lock on the thermostat (kid_lock).
   */
  async setThermostatLock(deviceMac, deviceModel, locked) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "kid_lock", locked ? "1" : "0");
  }

  /**
   * Set the comfort-balance behavior (Settings → Behavior).
   * @param {number} mode — see `WyzeAPI.ThermostatComfortBalanceMode` (1–5)
   */
  async setThermostatComfortBalance(deviceMac, deviceModel, mode) {
    this._validateOneOf(mode, types.ThermostatComfortBalanceMode, "setThermostatComfortBalance");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "save_comfort_balance", mode);
  }

  /**
   * Hold the current setpoint until a specific time (manual hold).
   * Sets `dev_hold` true and `dev_holdtime` to the given epoch.
   * @param {Date|number} until — Date or epoch ms
   */
  async holdThermostat(deviceMac, deviceModel, until) {
    const ts = until instanceof Date ? until.getTime() : until;
    if (!Number.isFinite(ts)) {
      throw new Error("holdThermostat: `until` must be a Date or epoch ms");
    }
    await this.thermostatSetIotProp(deviceMac, deviceModel, "dev_hold", "1");
    await this.thermostatSetIotProp(deviceMac, deviceModel, "dev_holdtime", String(ts));
  }

  /**
   * Clear an active manual hold so the thermostat returns to its schedule.
   */
  async clearThermostatHold(deviceMac, deviceModel) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "dev_hold", "0");
  }

  // Thermostat device-object helpers (homebridge-style — accept a device).

  async thermostatSystemMode(device, mode) {
    return this.setThermostatSystemMode(device.mac, device.product_model, mode);
  }

  async thermostatFanMode(device, mode) {
    return this.setThermostatFanMode(device.mac, device.product_model, mode);
  }

  async thermostatScenario(device, scenario) {
    return this.setThermostatScenario(device.mac, device.product_model, scenario);
  }

  async thermostatHeatingSetpoint(device, value) {
    return this.setThermostatHeatingSetpoint(device.mac, device.product_model, value);
  }

  async thermostatCoolingSetpoint(device, value) {
    return this.setThermostatCoolingSetpoint(device.mac, device.product_model, value);
  }

  async thermostatTemperature(device, coolingSetpoint, heatingSetpoint) {
    return this.setThermostatTemperature(device.mac, device.product_model, coolingSetpoint, heatingSetpoint);
  }

  async thermostatLock(device, locked) {
    return this.setThermostatLock(device.mac, device.product_model, locked);
  }

  async thermostatComfortBalance(device, mode) {
    return this.setThermostatComfortBalance(device.mac, device.product_model, mode);
  }

  async thermostatHold(device, until) {
    return this.holdThermostat(device.mac, device.product_model, until);
  }

  async thermostatClearHold(device) {
    return this.clearThermostatHold(device.mac, device.product_model);
  }

    // Construct the characteristics object
  // Irrigation / sprinkler — all olive-signed against the lockwood service.
  // These were six near-identical inline blocks; consolidated through the
  // shared olive primitives. Wire format unchanged.

  async irrigationGetIotProp(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys =
      "zone_state,iot_state,iot_state_update_time,app_version,RSSI,wifi_mac,sn,device_model,ssid,IP";
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}get_iot_prop`,
      payload,
      "IrrigationGetIotProp"
    );
  }

  async irrigationGetDeviceInfo(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys =
      "wiring,sensor,enable_schedules,notification_enable,notification_watering_begins,notification_watering_ends,notification_watering_is_skipped,skip_low_temp,skip_wind,skip_rain,skip_saturation";
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}device_info`,
      payload,
      "IrrigationGetDeviceInfo"
    );
  }

  async irrigationGetZones(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}zone`,
      payload,
      "IrrigationGetZones"
    );
  }

  async irrigationQuickRun(deviceMac, zoneNumber, duration) {
    const payload = payloadFactory.oliveCreatePostPayloadIrrigationQuickRun(
      deviceMac,
      zoneNumber,
      duration
    );
    return this._oliveSignedPost(
      `${constants.irrigationBaseUrl}quickrun`,
      payload,
      "IrrigationQuickRun"
    );
  }

  async irrigationStop(deviceMac) {
    const payload = payloadFactory.oliveCreatePostPayloadIrrigationStop(deviceMac, "STOP");
    return this._oliveSignedPost(
      `${constants.irrigationBaseUrl}runningschedule`,
      payload,
      "IrrigationStop"
    );
  }

  async irrigationGetScheduleRuns(deviceMac, limit = 2) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigationScheduleRuns(deviceMac);
    payload.limit = limit;
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}schedule_runs`,
      payload,
      "IrrigationGetScheduleRuns"
    );
  }

  /**
   * Sends a command to a local smart bulb device to set a specific property value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} deviceEnr - The encrypted device identifier.
   * @param {string} deviceIp - The IP address of the device.
   * @param {string} propertyId - The ID of the property to set.
   * @param {string|number} propertyValue - The value to set for the property.
   * @param {string} actionKey - The action key used for the command (for future use).
   * @return {Promise<void>} A promise that resolves when the command is sent or handles errors if the command fails.
   */
   async localBulbCommand(deviceMac, deviceModel, deviceEnr, deviceIp, propertyId, propertyValue, actionKey) {
    const plist = [
      { pid: propertyId, pvalue: String(propertyValue) }
    ];

    const characteristics = {
      mac: deviceMac.toUpperCase(), // Convert MAC address to uppercase
      index: '1', // Fixed index value
      ts: moment().valueOf(), // Current timestamp in milliseconds
      plist: plist // Property list with the ID and value
    };

    // Convert characteristics object to JSON string
    const characteristicsStr = JSON.stringify(characteristics, null, 0);
    console.log(`Characteristics JSON: ${characteristicsStr}`);

    // Encrypt the JSON string
    const characteristicsEnc = util.wyzeEncrypt(deviceEnr, characteristicsStr);
    console.log(`Encrypted characteristics: ${characteristicsEnc}`);

    // Create the payload for the request
    const payload = {
      request: 'set_status', // Request type
      isSendQueue: 0, // Flag indicating whether to send the request immediately
      characteristics: characteristicsEnc // Encrypted characteristics data
    };

    // Convert payload to JSON string and fix any escaped backslashes
    const payloadStr = JSON.stringify(payload, null, 0).replace(/\\\\/g, '\\');
    console.log(`Payload JSON: ${payloadStr}`);

    // Define the URL for the local device request
    const url = `http://${deviceIp}:88/device_request`;
    console.log(`Sending request to URL: ${url}`);

    try {
      // Send the POST request to the local device
      const response = await axios.post(url, payloadStr, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Log the response data
      console.log(`Response received from device ${deviceMac}:`, response.data);
    } catch (error) {
      if (error.response) {
        // Log the HTTP error details
        console.warn(`Failed to connect to bulb ${deviceMac}. HTTP status: ${error.response.status}. Response data:`, error.response.data);

        // Handle fallback to cloud
        console.log(`Attempting to fallback to cloud for device ${deviceMac}.`);
        await runActionList(deviceMac, deviceModel, propertyId, propertyValue, actionKey);
      } else {
        // Log other types of errors
        console.error(`Error occurred while sending command to device ${deviceMac}:`, error);
      }
    }
  }

  async authenticateAndFetchData() {
    const rokuAuth = new RokuAuthLib(this.username, this.password);
    const token = await rokuAuth.getTokenWithUsernamePassword(this.username, this.password);

    print(token)
  }


  /**
   * Opt-in analytics ping that mirrors what the Wyze app fires after each
   * vacuum control action. Not required for controls to take effect — call
   * it only if you want to look identical to the official client on the
   * wire (e.g. for telemetry-sensitive accounts).
   *
   * @param {string} mac
   * @param {number} typeCode — VacuumControlType code
   * @param {number} valueCode — VacuumControlValue code
   * @param {string[]} args — VenusDotArg1/2/3 strings; positional arg1..argN
   */
  async vacuumEventTracking(mac, typeCode, valueCode, args = []) {
    const payload = {
      uuid: constants.vacuumEventTrackingUuid,
      deviceId: mac,
      createTime: String(Date.now()),
      mcuSysVersion: constants.vacuumFirmwareVersion,
      appVersion: this.appVersion,
      pluginVersion: constants.venusPluginVersion,
      phoneId: this.phoneId,
      phoneOsVersion: "16.0",
      eventKey: types.VacuumControlTypeDescription[typeCode],
      eventType: valueCode,
    };
    args.forEach((value, index) => {
      payload[`arg${index + 1}`] = value;
    });
    payload.arg11 = "ios";
    payload.arg12 = "iPhone 13 mini";
    return this._venusRequest("POST", "/plugin/venus/event_tracking", payload);
  }

  /**
   * Filter the device list down to robot vacuums.
   * @returns {Promise<Array>}
   */
  async getVacuumDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => constants.vacuumModels.includes(d.product_model));
  }

  /**
   * Look up a single vacuum by MAC.
   * @param {string} mac
   */
  async getVacuum(mac) {
    const vacuums = await this.getVacuumDeviceList();
    return vacuums.find((v) => v.mac === mac);
  }

  /**
   * Combined snapshot of a vacuum: list entry merged with live IoT props,
   * device info, status (event/heartbeat), current position, and current map.
   *
   * Returns `null` if the mac is not a vacuum on this account. Failures of
   * individual sub-fetches are logged and the corresponding fields are left
   * out — this method never throws on a single missing piece.
   *
   * @param {string} mac
   * @returns {Promise<Object|null>}
   */
  async getVacuumInfo(mac) {
    const vacuum = await this.getVacuum(mac);
    if (!vacuum) return null;

    const result = { ...vacuum };

    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        this.log.warning(`getVacuumInfo: ${label} failed: ${err.message}`);
        return null;
      }
    };

    const iotProp = await safe("get_iot_prop", () =>
      this.getVacuumIotProp(mac, types.VacuumIotPropKeys)
    );
    if (iotProp?.data?.props) Object.assign(result, iotProp.data.props);

    const deviceInfo = await safe("device_info", () =>
      this.getVacuumDeviceInfo(mac, types.VacuumDeviceInfoKeys)
    );
    if (deviceInfo?.data?.settings) Object.assign(result, deviceInfo.data.settings);

    const status = await safe("status", () => this.getVacuumStatus(mac));
    if (status?.data?.eventFlag) Object.assign(result, status.data.eventFlag);
    if (status?.data?.heartBeat) Object.assign(result, status.data.heartBeat);

    const position = await safe("current_position", () =>
      this.getVacuumCurrentPosition(mac)
    );
    if (position?.data) result.current_position = position.data;

    const map = await safe("current_map", () => this.getVacuumCurrentMap(mac));
    if (map?.data) result.current_map = map.data;

    return result;
  }

  /**
   * Read live IoT properties for a vacuum (battery, mode, etc.).
   * @param {string} mac
   * @param {string|string[]} keys — comma-joined when an array
   */
  async getVacuumIotProp(mac, keys) {
    const params = { did: mac };
    if (keys != null) params.keys = Array.isArray(keys) ? keys.join(",") : keys;
    return this._venusRequest("GET", "/plugin/venus/get_iot_prop", params);
  }

  /**
   * Read device-level settings (suction level, etc.) for a vacuum.
   * @param {string} mac
   * @param {string|string[]} keys
   */
  async getVacuumDeviceInfo(mac, keys) {
    const params = { device_id: mac };
    if (keys != null) params.keys = Array.isArray(keys) ? keys.join(",") : keys;
    return this._venusRequest("GET", "/plugin/venus/device_info", params);
  }

  /**
   * Heartbeat / event status for a vacuum.
   * @param {string} mac
   */
  async getVacuumStatus(mac) {
    return this._venusRequest("GET", `/plugin/venus/${mac}/status`);
  }

  async getVacuumCurrentPosition(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/current_position", { did: mac });
  }

  async getVacuumCurrentMap(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/current_map", { did: mac });
  }

  async getVacuumMaps(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/list", { did: mac });
  }

  /**
   * Set the active map for a vacuum.
   * @param {string} mac
   * @param {number} mapId
   */
  async setVacuumCurrentMap(mac, mapId) {
    return this._venusRequest("POST", "/plugin/venus/memory_map/current_map", {
      device_id: mac,
      map_id: mapId,
    });
  }

  /**
   * Sweep history.
   * @param {string} mac
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @param {Date|number} [options.since] — Date or epoch ms; defaults to now
   */
  async getVacuumSweepRecords(mac, options = {}) {
    const { limit = 20, since = Date.now() } = options;
    const lastTime = since instanceof Date ? since.getTime() : since;
    return this._venusRequest("GET", "/plugin/venus/sweep_record/query_data", {
      did: mac,
      purpose: "history_map",
      count: limit,
      last_time: lastTime,
    });
  }

  /**
   * Low-level control. Prefer the named methods (vacuumClean, vacuumPause, ...)
   * unless you specifically need AREA_CLEAN or QUICK_MAPPING.
   * @param {string} mac
   * @param {number} type — see VacuumControlType
   * @param {number} value — see VacuumControlValue
   * @param {Object} [extras] — e.g. `{ rooms_id: [11, 14] }`
   */
  async vacuumControl(mac, type, value, extras = {}) {
    const payload = { type, value, vacuumMopMode: 0, ...extras };
    return this._venusRequest("POST", `/plugin/venus/${mac}/control`, payload);
  }

  /**
   * Start (or resume) a whole-home cleaning. Wyze handles start vs. resume
   * server-side based on the current vacuum state.
   * @param {string} mac
   */
  async vacuumClean(mac) {
    return this.vacuumControl(mac, VacuumControlType.GLOBAL_SWEEPING, VacuumControlValue.START);
  }

  /**
   * Pause an in-progress cleaning.
   * @param {string} mac
   */
  async vacuumPause(mac) {
    return this.vacuumControl(mac, VacuumControlType.GLOBAL_SWEEPING, VacuumControlValue.PAUSE);
  }

  /**
   * Send the vacuum back to its charging dock.
   * @param {string} mac
   */
  async vacuumDock(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.START);
  }

  /**
   * Stop a return-to-dock currently in progress.
   * @param {string} mac
   */
  async vacuumStop(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.STOP);
  }

  /**
   * Cancel a pending "resume after charging" state. Same wire payload as
   * {@link vacuumStop}; named separately for caller clarity.
   * @param {string} mac
   */
  async vacuumCancel(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.STOP);
  }

  /**
   * Clean specific rooms by id (from the current map).
   * @param {string} mac
   * @param {number|number[]} roomIds
   */
  async vacuumSweepRooms(mac, roomIds) {
    const ids = Array.isArray(roomIds) ? roomIds : [roomIds];
    return this.vacuumControl(
      mac,
      VacuumControlType.GLOBAL_SWEEPING,
      VacuumControlValue.START,
      { rooms_id: ids }
    );
  }

  /**
   * Set vacuum suction level.
   * @param {string} mac
   * @param {string} model — e.g. "JA_RO2"
   * @param {number} level — see VacuumSuctionLevel (1=Quiet, 2=Standard, 3=Strong)
   */
  async vacuumSetSuctionLevel(mac, model, level) {
    return this._venusRequest("POST", "/plugin/venus/set_iot_action", {
      did: mac,
      model,
      cmd: "set_preference",
      params: [{ ctrltype: VacuumPreferenceType.SUCTION, value: level }],
      is_sub_device: 0,
    });
  }

  /**
   * Helper functions
   */

  async getObjectListSafe() {
    try {
      return await this.getObjectList();
    } catch (error) {
      this.log.error(`Failed to get object list: ${error.message}`);
      throw error;
    }
  }

  async getDeviceList() {
    const result = await this.getObjectListSafe();
    return result.data.device_list || [];
  }

  async getDeviceByName(nickname) {
    const devices = await this.getDeviceList();
    return devices.find(device => device.nickname.toLowerCase() === nickname.toLowerCase());
  }

  async getDeviceByMac(mac) {
    const devices = await this.getDeviceList();
    return devices.find(device => device.mac === mac);
  }

  async getDevicesByType(type) {
    const devices = await this.getDeviceList();
    return devices.filter(device => device.product_type.toLowerCase() === type.toLowerCase());
  }

  async getDevicesByModel(model) {
    const devices = await this.getDeviceList();
    return devices.filter(device => device.product_model.toLowerCase() === model.toLowerCase());
  }

  async getDeviceGroupsList() {
    const result = await this.getObjectListSafe();
    return result.data.device_group_list || [];
  }

  async getDeviceSortList() {
    const result = await this.getObjectListSafe();
    return result.data.device_sort_list || [];
  }

  async getDeviceStatus(device) {
    return device.device_params;
  }

  async getDevicePID(deviceMac, deviceModel) {
    return await this.getPropertyList(deviceMac, deviceModel);
  }

  /**
   * Generic device-info read — wraps `app/v2/device/get_device_Info`. Returns
   * the device's per-model settings and current state. Useful for any
   * family that doesn't have a dedicated info-reader.
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async getDeviceInfo(deviceMac, deviceModel) {
    const data = { device_mac: deviceMac, device_model: deviceModel };
    const result = await this.request("app/v2/device/get_device_Info", data);
    return result.data;
  }

  // Sensors — Wyze Sense contact (DWS3U/DWS2U) and motion (PIR3U/PIR2U).
  // Read-only family; state changes are reported by the device, not pushed.

  /**
   * Filter device list to contact sensors.
   */
  async getContactSensorList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => types.DeviceModels.CONTACT_SENSOR.includes(d.product_model));
  }

  /**
   * Single contact-sensor lookup by mac.
   */
  async getContactSensor(mac) {
    const sensors = await this.getContactSensorList();
    return sensors.find((d) => d.mac === mac);
  }

  /**
   * Combined: list entry + device-info merge for a contact sensor.
   */
  async getContactSensorInfo(mac) {
    const sensor = await this.getContactSensor(mac);
    if (!sensor) return null;
    const result = { ...sensor };
    try {
      const info = await this.getDeviceInfo(sensor.mac, sensor.product_model);
      if (info?.data) Object.assign(result, info.data);
    } catch (err) {
      this.log.warning(`getContactSensorInfo: device_info failed: ${err.message}`);
    }
    return result;
  }

  /**
   * Filter device list to motion sensors.
   */
  async getMotionSensorList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => types.DeviceModels.MOTION_SENSOR.includes(d.product_model));
  }

  async getMotionSensor(mac) {
    const sensors = await this.getMotionSensorList();
    return sensors.find((d) => d.mac === mac);
  }

  async getMotionSensorInfo(mac) {
    const sensor = await this.getMotionSensor(mac);
    if (!sensor) return null;
    const result = { ...sensor };
    try {
      const info = await this.getDeviceInfo(sensor.mac, sensor.product_model);
      if (info?.data) Object.assign(result, info.data);
    } catch (err) {
      this.log.warning(`getMotionSensorInfo: device_info failed: ${err.message}`);
    }
    return result;
  }

  // Pure sensor accessors — expect a merged sensor info object (from
  // getContactSensorInfo / getMotionSensorInfo). Return null when the
  // expected field isn't present.

  // Cross-cutting pure accessors. Operate on any device object that comes
  // out of the API (or any *info object that merges device_params into the
  // top level). All return null when the field isn't present, never throw.

  async cameraPrivacy(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  }

  async cameraTurnOn(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "wakeup");
    }
    await this.runAction(deviceMac, deviceModel, "power_on");
  }

  async cameraTurnOff(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "sleep");
    }
    await this.runAction(deviceMac, deviceModel, "power_off");
  }

  /**
   * Restart a camera. Same wire as `runAction(mac, model, "restart")`.
   */
  async cameraRestart(deviceMac, deviceModel) {
    return this.runAction(deviceMac, deviceModel, "restart");
  }

  /**
   * Recent camera events (motion / sound / face / etc.). Wraps
   * `app/v2/device/get_event_list`.
   *
   * @param {Object} [options]
   * @param {number}   [options.count=20]
   * @param {Date|number} [options.beginTime] — defaults to one hour ago
   * @param {Date|number} [options.endTime]   — defaults to now
   * @param {string}   [options.deviceMac]    — filter to a single camera
   * @param {string[]} [options.eventValueList=["1","13","10","12"]] — event types
   * @param {number}   [options.orderBy=2]    — 2 = reverse-chronological
   */
  async getCameraEventList(options = {}) {
    const {
      count = 20,
      beginTime = Date.now() - 60 * 60 * 1000,
      endTime = Date.now(),
      deviceMac = "",
      eventValueList = ["1", "13", "10", "12"],
      orderBy = 2,
    } = options;
    const data = {
      begin_time: beginTime instanceof Date ? beginTime.getTime() : beginTime,
      end_time: endTime instanceof Date ? endTime.getTime() : endTime,
      event_type: "",
      count,
      order_by: orderBy,
      event_value_list: eventValueList,
      device_mac: deviceMac,
      device_mac_list: [],
      event_tag_list: [],
    };
    const result = await this.request("app/v2/device/get_event_list", data);
    return result.data;
  }

  /**
   * Account-level push notification toggle. Affects all devices on the
   * account; per-device toggles still apply on top.
   * @param {boolean} on
   */
  async setPushInfo(on) {
    const data = { push_switch: on ? "1" : "0" };
    const result = await this.request("app/user/set_push_info", data);
    return result.data;
  }

  /**
   * Open or Close Garage Door Depending on current state
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async garageDoor(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "garage_door_trigger");
  }

  async cameraSiren(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  }

  /**
   * Turn Camera Siren ON
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async cameraSirenOn(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-on");
    }
    await this.runAction(deviceMac, deviceModel, "siren_on");
  }

  /**
   * Turn Camera Siren OFF
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async cameraSirenOff(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-off");
    }
    await this.runAction(deviceMac, deviceModel, "siren_off");
  }

  async turnMeshOn(deviceMac, deviceModel) {
    return await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.ON,
      "1",
      "set_mesh_property"
    );
  }

  async turnMeshOff(deviceMac, deviceModel) {
    return await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.ON,
      "0",
      "set_mesh_property"
    );
  }

  // Vacuum convenience helpers — accept a `device` object (as returned by
  // getVacuumDeviceList / getDeviceList) so callers like homebridge plugins
  // don't need to remember mac/model/level codes.

  async vacuumStartCleaning(device) {
    return this.vacuumClean(device.mac);
  }

  async vacuumPauseCleaning(device) {
    return this.vacuumPause(device.mac);
  }

  async vacuumReturnToDock(device) {
    return this.vacuumDock(device.mac);
  }

  async vacuumCleanRooms(device, roomIds) {
    return this.vacuumSweepRooms(device.mac, roomIds);
  }

  async vacuumQuiet(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, types.VacuumSuctionLevel.QUIET);
  }

  async vacuumStandard(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, types.VacuumSuctionLevel.STANDARD);
  }

  async vacuumStrong(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, types.VacuumSuctionLevel.STRONG);
  }

  async vacuumInfo(device) {
    return this.getVacuumInfo(device.mac);
  }

  // Battery / mode / status accessors — pure, operate on the merged result
  // of getVacuumInfo() (or any object containing the same keys). Returning
  // null on missing fields lets callers chain optionally without throwing.

  vacuumGetBattery(info) {
    // "battary" is the literal Wyze key (typo preserved by the server).
    return typeof info?.battary === "number" ? info.battary : null;
  }

  vacuumGetMode(info) {
    return types.parseVacuumMode(info?.mode);
  }

  vacuumGetFault(info) {
    const code = info?.fault_code;
    if (typeof code !== "number" || code === 0) return null;
    return { code, description: types.VacuumFaultCode[code] ?? null };
  }

  vacuumIsCharging(info) {
    return Boolean(info?.chargeState);
  }

  vacuumIsCleaning(info) {
    return this.vacuumGetMode(info) === "CLEANING";
  }

  vacuumIsDocked(info) {
    const mode = this.vacuumGetMode(info);
    return mode === "IDLE" || this.vacuumIsCharging(info);
  }

  async unlockLock(device) {
    return await this.controlLock(
      device.mac,
      device.product_model,
      "remoteUnlock"
    );
  }

  async lockLock(device) {
    return await this.controlLock(
      device.mac,
      device.product_model,
      "remoteLock"
    );
  }

  async lockInfo(device) {
    return await this.getLockInfo(device.mac, device.product_model);
  }

  // Wyze Lock V1 (YD.LO1) — additional Ford-service reads.
  // Existing methods (controlLock, getLockInfo) already use the Ford signing
  // path via payloadFactory.fordCreatePayload + crypto.fordCreateSignature;
  // these new reads reuse that same machinery.


  /**
   * Filter the device list down to V1 locks (YD.LO1).
   */
  async getLockDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => types.DeviceModels.LOCK.includes(d.product_model));
  }

  /**
   * Filter the device list down to lock gateways (YD.GW1).
   */
  async getLockGatewayList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => types.DeviceModels.LOCK_GATEWAY.includes(d.product_model));
  }

  /**
   * Read details about a paired keypad.
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async getLockKeypadInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/keypad/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  }

  /**
   * Read details about the lock's gateway (the Wi-Fi bridge).
   * @param {string} deviceMac
   * @param {string} deviceModel — pass the gateway's model (`YD.GW1`)
   */
  async getLockGatewayInfo(deviceMac, deviceModel) {
    return this._fordGet("/openapi/gateway/v1/info", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  }

  /**
   * Get the secret used to encrypt new access codes.
   * Required input for `add_password` / `update_password` (deferred follow-up).
   */
  async getLockCryptSecret() {
    return this._fordGet("/openapi/v1/crypt_secret");
  }

  /**
   * Count of safety-record events for a lock.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Date|number} since — earliest time (Date or epoch ms)
   * @param {Date|number} [until]
   */
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
  }

  /**
   * Lock event records (lock/unlock events with source — App / Keypad /
   * Fingerprint / Manual / NFC / Auto / Remote).
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} options
   * @param {Date|number} options.since — earliest time
   * @param {Date|number} [options.until]
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
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
  }

  /**
   * List access-code "keys" (passwords) on the lock. Returns metadata only —
   * the actual code values are encrypted on the server and not exposed.
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async getLockKeys(deviceMac, deviceModel) {
    return this._fordGet("/openapi/lock/v1/pwd", {
      uuid: this.getUuid(deviceMac, deviceModel),
    });
  }

  /**
   * Build a JSON-ready LockKeyPermission object (the wire shape expected by
   * add/update access code calls).
   *
   * Per type:
   *   - ALWAYS    (1): no time bounds
   *   - DURATION  (2): begin/end (epoch seconds, inclusive)
   *   - ONCE      (3): begin/end (single window)
   *   - RECURRING (4): begin/end forced to 0; pair with a periodicity object
   *
   * @param {number} type — see WyzeAPI.LockKeyPermissionType
   * @param {Date|number} [begin] — Date or epoch seconds
   * @param {Date|number} [end]
   */
  buildLockKeyPermission(type, begin, end) {
    if (!Object.values(types.LockKeyPermissionType).includes(type)) {
      throw new Error(`buildLockKeyPermission: invalid type ${type}`);
    }
    const out = { status: type };
    const toEpochSec = (v) => {
      if (v == null) return null;
      if (v instanceof Date) return Math.floor(v.getTime() / 1000);
      if (typeof v === "number") return Math.floor(v);
      throw new Error("buildLockKeyPermission: begin/end must be Date or epoch seconds");
    };
    if (type === types.LockKeyPermissionType.RECURRING) {
      out.begin = 0;
      out.end = 0;
    } else if (
      type === types.LockKeyPermissionType.DURATION ||
      type === types.LockKeyPermissionType.ONCE
    ) {
      const b = toEpochSec(begin);
      const e = toEpochSec(end);
      if (b !== null) out.begin = b;
      if (e !== null) out.end = e;
    }
    return out;
  }

  /**
   * Build a JSON-ready LockKeyPeriodicity object for RECURRING access codes.
   * @param {Object} options
   * @param {string|Date} options.begin — "HHMMSS" string or Date (time-of-day)
   * @param {string|Date} options.end
   * @param {number[]} options.validDays — day-of-week numbers (1=Mon..7=Sun, per Wyze app)
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
  }

  /**
   * Create a guest access code on a lock. The code is encrypted in transit
   * with the lock's crypt secret (fetched from `getLockCryptSecret()`).
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} options
   * @param {string} options.accessCode — 4–8 digit numeric PIN
   * @param {string} [options.name] — guest name
   * @param {string} options.userId — user id of the lock owner (required)
   * @param {Object} [options.permission] — from `buildLockKeyPermission()`. Defaults to ALWAYS.
   * @param {Object} [options.periodicity] — from `buildLockKeyPeriodicity()`. Required when permission.type is RECURRING.
   */
  async addLockAccessCode(deviceMac, deviceModel, options) {
    const { accessCode, name, userId, permission, periodicity } = options;
    if (!/^\d{4,8}$/.test(String(accessCode))) {
      throw new Error("addLockAccessCode: accessCode must be 4–8 digits");
    }
    if (!userId) throw new Error("addLockAccessCode: userId is required");

    const perm = permission ?? this.buildLockKeyPermission(types.LockKeyPermissionType.ALWAYS);
    if (perm.status === types.LockKeyPermissionType.RECURRING && !periodicity) {
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
  }

  /**
   * Update an existing access code on a lock.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} options
   * @param {number|string} options.accessCodeId
   * @param {string} [options.accessCode] — new PIN (if changing)
   * @param {string} [options.name]
   * @param {Object} options.permission — required (use buildLockKeyPermission)
   * @param {Object} [options.periodicity]
   */
  async updateLockAccessCode(deviceMac, deviceModel, options) {
    const { accessCodeId, accessCode, name, permission, periodicity } = options;
    if (accessCodeId == null) throw new Error("updateLockAccessCode: accessCodeId is required");
    if (!permission) throw new Error("updateLockAccessCode: permission is required");
    if (permission.status === types.LockKeyPermissionType.RECURRING && !periodicity) {
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
  }

  /**
   * Delete an access code by id.
   */
  async deleteLockAccessCode(deviceMac, deviceModel, accessCodeId) {
    if (accessCodeId == null) throw new Error("deleteLockAccessCode: accessCodeId is required");
    return this._fordPost("/openapi/lock/v1/pwd/operations/delete", {
      uuid: this.getUuid(deviceMac, deviceModel),
      passwordid: String(accessCodeId),
    });
  }

  /**
   * Rename an access code. Uses HTTP PUT (not POST) per the Wyze API.
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
  }

  /**
   * Combined snapshot of a lock — list entry + lock info + crypt secret +
   * record count. Tolerates partial sub-fetch failures.
   *
   * @param {string} mac
   * @returns {Promise<Object|null>}
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
  }

  // Device-object helpers — accept the `device` returned by getDeviceList /
  // getLockDeviceList so callers don't have to remember mac/model pairs.

  async lockKeypad(device) {
    return this.getLockKeypadInfo(device.mac, device.product_model);
  }

  async lockGateway(device) {
    return this.getLockGatewayInfo(device.mac, device.product_model);
  }

  async lockRecords(device, options = {}) {
    return this.getLockRecords(device.mac, device.product_model, options);
  }

  async lockKeys(device) {
    return this.getLockKeys(device.mac, device.product_model);
  }

  async lockFullInfo(device) {
    return this.getLockFullInfo(device.mac);
  }

  // IoT3 API — used by Lock Bolt V2 (DX_LB2) and Palm lock (DX_PVLOC).
  // Helpers (_iot3ExtractModel / _iot3BuildHeaders / _iot3Post) live in
  // services/iot3.js and are mixed onto the prototype below.

  async iot3GetProperties(deviceMac, deviceModel, props) {
    await this.maybeLogin();
    const payload = payloadFactory.iot3CreateGetPayload(
      deviceMac,
      this._iot3ExtractModel(deviceMac, deviceModel),
      props
    );
    return this._iot3Post("/app/v4/iot3/get-property", payload);
  }

  async iot3RunAction(deviceMac, deviceModel, action) {
    await this.maybeLogin();
    const payload = payloadFactory.iot3CreateRunActionPayload(
      deviceMac,
      this._iot3ExtractModel(deviceMac, deviceModel),
      action,
      this.username
    );
    return this._iot3Post("/app/v4/iot3/run-action", payload);
  }

  async lockBoltV2GetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "lock::door-status",
      "iot-device::iot-state",
      "battery::battery-level",
      "battery::power-source",
      "device-info::firmware-ver",
    ]);
  }

  async lockBoltV2Lock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::lock");
  }

  async lockBoltV2Unlock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::unlock");
  }

  async palmLockGetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "battery::battery-level",
      "iot-device::iot-state",
      "device-info::firmware-ver",
    ]);
  }

  /**
   * Sets the flood light property of a camera to a specified value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} value - The value to set for the flood light property.
   * @return {Promise<void>} A promise that resolves when the property has been set.
   */
  async cameraFloodLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
  }

  /**
   * Turns on the flood light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the flood light has been turned on.
   */
  async cameraFloodLightOn(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "floodlight", "1");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.ON);
  }

  /**
   * Turns off the flood light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the flood light has been turned off.
   */
  async cameraFloodLightOff(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "floodlight", "0");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.OFF);
  }

  /**
   * Sets the spot light property of a camera to a specified value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} value - The value to set for the spot light property.
   * @return {Promise<void>} A promise that resolves when the property has been set.
   */
  async cameraSpotLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
  }

  /**
   * Turns on the spot light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the spot light has been turned on.
   */
  async cameraSpotLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.ON);
  }

  /**
   * Turns off the spot light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the spot light has been turned off.
   */
  async cameraSpotLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.OFF);
  }

  /**
   * Turns on motion detection for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion detection has been turned on.
   */
  async cameraMotionOn(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, types.DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "1"
      );
    }
    if (
      types.DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      types.DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      // Wyze Cam Outdoor (WVOD1 / HL_WCO2) uses a separate PID.
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "1");
    }
    // Standard cameras need both PIDs: the toggle (P1001) and the state (P1047).
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 1);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 1);
  }

  /**
   * Turns off motion detection for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion detection has been turned off.
   */
  async cameraMotionOff(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, types.DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "0"
      );
    }
    if (
      types.DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      types.DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "0");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 0);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 0);
  }

  /**
   * Turns on sound notifications for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when sound notifications have been turned on.
   */
  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "1");
  }

  /**
   * Turns off sound notifications for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when sound notifications have been turned off.
   */
  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "0");
  }

  /**
   * Sets the notification property of a camera to a specified value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} value - The value to set for the notification property.
   * @return {Promise<void>} A promise that resolves when the property has been set.
   */
  async cameraNotifications(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, value);
  }

  /**
   * Turns on camera notifications.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when notifications have been turned on.
   */
  async cameraNotificationsOn(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, types.DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "1"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "1");
  }

  /**
   * Turns off camera notifications.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when notifications have been turned off.
   */
  async cameraNotificationsOff(deviceMac, deviceModel) {
    if (types.DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, types.DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "0"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "0");
  }

  /**
   * Sets the motion recording property of a camera to a specified value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} value - The value to set for the motion recording property.
   * @return {Promise<void>} A promise that resolves when the property has been set.
   */
  async cameraMotionRecording(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, value);
  }

  /**
   * Turns on motion recording for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion recording has been turned on.
   */
  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "1");
  }

  /**
   * Turns off motion recording for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion recording has been turned off.
   */
  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "0");
  }

  /**
   * Fetch the WebRTC stream info for a camera. Returns a Kinesis Video
   * signaling URL plus ICE/STUN/TURN servers — the credentials needed to
   * negotiate a live WebRTC stream. Does not return a playable URL on its
   * own; a WebRTC client (e.g. werift, go2rtc) is required to consume it.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} [options]
   * @param {boolean} [options.substream=false] — request the lower-bitrate sub stream (experimental; depends on camera support)
   * @returns {Promise<{signaling_url: string, ice_servers: Array<{url: string, username: string, credential: string}>}>}
   */
  async cameraGetStreamInfo(deviceMac, deviceModel, options = {}) {
    await this.maybeLogin();

    const parameters = { use_trickle: true };
    if (options.substream) parameters.sub_stream = true;

    const payload = {
      device_list: [
        {
          device_id: deviceMac,
          device_model: deviceModel,
          provider: "webrtc",
          parameters,
        },
      ],
      nonce: String(Date.now()),
    };
    const body = JSON.stringify(payload);
    const signature = crypto.web_create_signature(body, this.access_token);

    const headers = {
      "Accept-Encoding": "gzip",
      appId: constants.webAppId,
      appInfo: constants.webAppInfo,
      access_token: this.access_token,
      Authorization: this.access_token,
      signature2: signature,
      requestid: String(Date.now() % 100000),
      "Content-Type": "application/json; charset=utf-8",
    };

    const url = `${constants.iot3BaseUrl}/app/v4/camera/get-streams`;
    if (this.apiLogEnabled) {
      this.log.info(`Performing request: ${url}`);
    }
    try {
      const response = await axios.post(url, body, { headers });
      // Honor X-RateLimit-Remaining: sleeps if dangerously low. Won't throw.
      await this._checkRateLimit(response.headers);

      const data = response.data;
      if (this.apiLogEnabled) {
        this.log.info(`API response cameraGetStreamInfo: ${JSON.stringify(data)}`);
      }

      const code = data?.code;
      const errorMessage = data?.msg || data?.description || "";

      if (typeof code !== "undefined" && Number(code) !== 1) {
        if (this._isAccessTokenError(code, errorMessage)) {
          await this._handleAccessTokenError(response, errorMessage, code, url, body);
          throw new Error(
            `Wyze access token error (${code}): ${errorMessage}. Token has been refreshed; retry the call.`
          );
        }
        if (this._isRateLimitError(code, errorMessage)) {
          throw new Error(`Wyze API rate limited (${code}): ${errorMessage}`);
        }
        if (String(code) === constants.deviceOfflineCode) {
          throw new Error(`Camera is offline: ${JSON.stringify(data)}`);
        }
        throw new Error(`Wyze API Error (${code}) - ${errorMessage}`);
      }

      if (!Array.isArray(data.data) || data.data.length !== 1) {
        throw new Error(`Unexpected response from cameraGetStreamInfo: ${JSON.stringify(data)}`);
      }

      const entry = data.data[0];
      if (!entry.property) {
        throw new Error(`Unexpected response from cameraGetStreamInfo: ${JSON.stringify(entry)}`);
      }
      if (entry.property["iot-device::iot-state"] !== 1) {
        throw new Error(`Camera is offline: ${JSON.stringify(entry)}`);
      }
      if (entry.property["iot-device::iot-power"] !== 1) {
        throw new Error(`Camera is off: ${JSON.stringify(entry)}`);
      }
      return entry.params;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);
      if (error.response) {
        this.log.error(`Response cameraGetStreamInfo (${error.response.status} - ${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`);
      }
      throw error;
    }
  }

  /**
   * Convenience: return only the Kinesis Video WebRTC signaling URL.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @returns {Promise<string>}
   */
  async cameraGetSignalingUrl(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.signaling_url;
  }

  /**
   * Convenience: return only the ICE/STUN/TURN server list for WebRTC negotiation.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @returns {Promise<Array<{url: string, username: string, credential: string}>>}
   */
  async cameraGetIceServers(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.ice_servers;
  }

  // Camera helpers — pure (sync, operate on a device object)

  /**
   * @param {Object} device
   * @returns {boolean}
   */
  cameraIsOnline(device) {
    // Wyze's get_device_list reports online state under different fields
    // depending on device type and API version. Check the known ones in
    // priority order; first defined wins.
    if (device?.conn_state !== undefined) return device.conn_state === 1;
    if (device?.device_params?.status !== undefined) return device.device_params.status === 1;
    if (device?.is_online !== undefined) return Boolean(device.is_online);
    return false;
  }

  /**
   * @param {Object} device
   * @returns {string|null}
   */
  cameraGetThumbnail(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0]?.url ?? null;
    }
    return null;
  }

  /**
   * @param {Object} device
   * @returns {Object|null}
   */
  cameraGetSnapshot(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0] ?? null;
    }
    return null;
  }

  /**
   * @param {Object} device
   * @returns {{mac: string, productModel: string, nickname: string, online: boolean, thumbnail: string|null}}
   */
  cameraToSummary(device) {
    return {
      mac: device?.mac,
      productModel: device?.product_model,
      nickname: device?.nickname,
      online: this.cameraIsOnline(device),
      thumbnail: this.cameraGetThumbnail(device),
    };
  }

  // Camera helpers — lookup (async)

  async getCameras() {
    return this.getDevicesByType("Camera");
  }

  async getOnlineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => this.cameraIsOnline(camera));
  }

  /**
   * Look up a single camera by MAC address.
   * @param {string} mac
   * @returns {Promise<Object|undefined>}
   */
  async getCamera(mac) {
    const cameras = await this.getCameras();
    return cameras.find((camera) => camera.mac === mac);
  }

  async getCameraSnapshot(mac) {
    const camera = await this.getCamera(mac);
    return camera ? this.cameraGetSnapshot(camera) : null;
  }

  async getCameraSnapshotUrl(mac) {
    const snapshot = await this.getCameraSnapshot(mac);
    return snapshot?.url ?? null;
  }

  async getCameraSummaries() {
    const cameras = await this.getCameras();
    return cameras.map((device) => this.cameraToSummary(device));
  }

  /**
   * Capture a single JPEG frame by negotiating a headless WebRTC session
   * with the camera. Requires `ffmpeg` on the system PATH.
   *
   * Results are cached per-mac for `cacheTtlMs` (default 10s) so that rapid
   * repeat callers (e.g., multiple HomeKit accessories) share one capture.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=20000] — overall timeout for negotiation + frame
   * @param {boolean} [options.noCache=false] — bypass and overwrite the per-mac cache
   * @param {number} [options.cacheTtlMs=10000]
   * @returns {Promise<Buffer>} JPEG bytes
   */
  async cameraCaptureSnapshot(deviceMac, deviceModel, options = {}) {
    const { timeoutMs = 20_000, noCache = false, cacheTtlMs = 10_000 } = options;

    if (!this._snapshotCaptureCache) this._snapshotCaptureCache = new Map();
    if (!noCache) {
      const entry = this._snapshotCaptureCache.get(deviceMac);
      if (entry && entry.expiresAt > Date.now()) return entry.buffer;
    }

    const conn = await this.getCameraWebRTCConnectionInfo(deviceMac, deviceModel, {
      noCache: true,
      includeClientId: false,
    });

    const buffer = await cameraStreamCapture.captureStreamFrame({
      signalingUrl: conn.signalingUrl,
      iceServers: conn.iceServers,
      logger: this.apiLogEnabled ? this.log : null,
      timeoutMs,
    });

    if (!noCache) {
      this._snapshotCaptureCache.set(deviceMac, {
        buffer,
        expiresAt: Date.now() + cacheTtlMs,
      });
    }
    return buffer;
  }

  /**
   * Get a JPEG image for a camera. Tries the cloud thumbnail first; if
   * unavailable or the download fails, falls back to a live WebRTC capture
   * via {@link cameraCaptureSnapshot}.
   *
   * @param {string} mac
   * @param {Object} [options]
   * @param {boolean} [options.skipCloud=false] — go straight to live capture
   * @param {number} [options.timeoutMs] — forwarded to capture
   * @param {boolean} [options.noCache=false] — forwarded to capture
   * @returns {Promise<{buffer: Buffer, source: "cloud"|"capture"}>}
   */
  async getCameraSnapshotImage(mac, options = {}) {
    if (!options.skipCloud) {
      const cloud = await this.getCameraSnapshot(mac);
      if (cloud?.url) {
        try {
          const resp = await axios.get(cloud.url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(resp.data), source: "cloud" };
        } catch (err) {
          this.log.warning(`Cloud snapshot fetch failed, falling back to capture: ${err.message}`);
        }
      }
    }

    const camera = await this.getCamera(mac);
    if (!camera) throw new Error(`Camera not found: ${mac}`);
    const buffer = await this.cameraCaptureSnapshot(camera.mac, camera.product_model, options);
    return { buffer, source: "capture" };
  }

  /**
   * Look up a single camera by nickname (case-insensitive).
   * @param {string} nickname
   * @returns {Promise<Object|undefined>}
   */
  async getCameraByName(nickname) {
    const cameras = await this.getCameras();
    return cameras.find(
      (camera) => camera?.nickname?.toLowerCase() === nickname?.toLowerCase()
    );
  }

  async getOfflineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => !this.cameraIsOnline(camera));
  }

  // Camera helpers — device-info accessors

  cameraGetSignalStrength(device) {
    return device?.device_params?.signal_strength ?? null;
  }

  cameraGetIp(device) {
    return device?.device_params?.ip ?? null;
  }

  cameraGetFirmware(device) {
    return device?.firmware_ver ?? null;
  }

  cameraGetTimezone(device) {
    return device?.timezone_name ?? null;
  }

  cameraGetLastSeen(device) {
    const ts = device?.device_params?.last_login_time;
    return typeof ts === "number" ? new Date(ts) : null;
  }

  // Camera helpers — stream connection

  /**
   * Generate a unique client identifier for tracking a viewer's WebRTC
   * session against a camera. Useful for log correlation, for client-side
   * bookkeeping that distinguishes concurrent viewers, and for injection
   * into a Kinesis Video signaling URL via {@link setCameraSignalingClientId}.
   * @param {string|Object} deviceOrMac — a device object or MAC string
   * @param {string} [prefix="viewer"]
   * @returns {string}
   */
  createCameraStreamClientId(deviceOrMac, prefix = "viewer") {
    const mac = typeof deviceOrMac === "string" ? deviceOrMac : deviceOrMac?.mac;
    const safePrefix = String(prefix || "viewer").replace(/[^a-zA-Z0-9_-]/g, "-");
    const macSlug =
      (mac || "camera").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "camera";
    const random = nodeCrypto.randomBytes(4).toString("hex");
    return `${safePrefix}-${macSlug}-${Date.now()}-${random}`;
  }

  /**
   * Decode double-encoded Kinesis Video signaling URLs (Wyze occasionally
   * returns `%25` where `%` is intended). Idempotent on already-decoded URLs.
   * @param {string} signalingUrl
   * @returns {string}
   */
  normalizeCameraSignalingUrl(signalingUrl) {
    if (!signalingUrl || typeof signalingUrl !== "string") return signalingUrl;
    if (signalingUrl.includes("%25")) {
      try {
        return decodeURIComponent(signalingUrl);
      } catch (_) {
        return signalingUrl;
      }
    }
    return signalingUrl;
  }

  /**
   * Convert Wyze's `{url, username, credential}` ICE entries into the
   * `{urls, ...}` shape expected by `RTCPeerConnection`. Drops malformed
   * entries (missing `url`).
   * @param {Array<{url: string, username?: string, credential?: string}>} iceServers
   * @returns {Array<{urls: string, username?: string, credential?: string}>}
   */
  sanitizeCameraIceServers(iceServers = []) {
    return iceServers
      .map((server) => {
        if (!server || !server.url) return null;
        const out = { urls: server.url };
        if (server.username) out.username = server.username;
        if (server.credential) out.credential = server.credential;
        return out;
      })
      .filter(Boolean);
  }

  /**
   * Parse online/power state from a raw {@link cameraGetStreamInfo} response
   * without throwing. Returns null on malformed input.
   * @param {Object} streamInfoResponse
   * @returns {{online: boolean, powered: boolean}|null}
   */
  parseCameraStatus(streamInfoResponse) {
    try {
      const item = streamInfoResponse?.data?.[0];
      if (!item?.property) return null;
      return {
        online: item.property["iot-device::iot-state"] === 1,
        powered: item.property["iot-device::iot-power"] === 1,
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Bundle everything a WebRTC client needs to start a session with a camera:
   * the signed signaling URL (returned untouched — Wyze pre-signs it with
   * AWS SigV4), sanitized ICE servers (in the `{urls,...}` shape
   * `RTCPeerConnection` expects), and the `auth_token` from the API. Also
   * generates a client ID for app-side tracking; this is NOT injected into
   * the URL.
   *
   * Results are cached per (mac, model, substream) for {@link options.cacheTtlMs}
   * (default 60s) to avoid hammering the API on rapid reconnects. Pass
   * `noCache: true` to bypass.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} [options]
   * @param {boolean} [options.substream=false] — request the lower-bitrate sub stream
   * @param {boolean} [options.includeClientId=true] — generate (or accept) a client ID in the result
   * @param {string} [options.clientId] — caller-supplied client ID (overrides generation)
   * @param {string} [options.clientIdPrefix="viewer"] — prefix when generating a client ID
   * @param {boolean} [options.noCache=false] — bypass the in-memory cache
   * @param {number} [options.cacheTtlMs=60000] — cache TTL when caching is enabled
   * @returns {Promise<{signalingUrl: string, iceServers: Array<Object>, authToken: string|null, clientId?: string, mac: string, model: string, substream: boolean, cached: boolean}>}
   */
  _streamCacheKey(deviceMac, deviceModel, substream) {
    return `${deviceMac}:${deviceModel}:${substream ? "sub" : "main"}`;
  }

  async getCameraWebRTCConnectionInfo(deviceMac, deviceModel, options = {}) {
    const {
      substream = false,
      includeClientId = true,
      clientId,
      clientIdPrefix = "viewer",
      noCache = false,
      cacheTtlMs = 60_000,
    } = options;

    if (!this._streamInfoCache) this._streamInfoCache = new Map();
    const cacheKey = this._streamCacheKey(deviceMac, deviceModel, substream);
    let bundle;
    let cached = false;

    if (!noCache) {
      const entry = this._streamInfoCache.get(cacheKey);
      if (entry && entry.expiresAt > Date.now()) {
        bundle = entry.bundle;
        cached = true;
      }
    }

    if (!bundle) {
      const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, { substream });
      bundle = {
        signalingUrl: this.normalizeCameraSignalingUrl(info.signaling_url),
        iceServers: this.sanitizeCameraIceServers(info.ice_servers),
        authToken: info.auth_token ?? null,
      };
      if (!noCache) {
        this._streamInfoCache.set(cacheKey, {
          bundle,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
    }

    const result = {
      ...bundle,
      mac: deviceMac,
      model: deviceModel,
      substream,
      cached,
    };

    if (includeClientId) {
      result.clientId =
        clientId || this.createCameraStreamClientId(deviceMac, clientIdPrefix);
    }

    return result;
  }

  /**
   * Like {@link getCameraWebRTCConnectionInfo} but retries with exponential
   * backoff on transient failures.
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} [options] — forwarded to {@link getCameraWebRTCConnectionInfo}
   * @param {Object} [retryOptions]
   * @param {number} [retryOptions.maxAttempts=3]
   * @param {number} [retryOptions.baseDelayMs=2000]
   * @param {Function} [retryOptions.onRetry] — called as `(attempt, error)` before each retry
   * @returns {Promise<Object>}
   */
  async getCameraWebRTCConnectionInfoWithReconnect(
    deviceMac,
    deviceModel,
    options = {},
    retryOptions = {}
  ) {
    return this.cameraStreamWithReconnect(
      () => this.getCameraWebRTCConnectionInfo(deviceMac, deviceModel, options),
      retryOptions
    );
  }

  /**
   * Wrap any async stream-related call with exponential-backoff retry.
   * @param {Function} fn
   * @param {Object} [options]
   * @param {number} [options.maxAttempts=3]
   * @param {number} [options.baseDelayMs=2000]
   * @param {Function} [options.onRetry]
   */
  async cameraStreamWithReconnect(fn, { maxAttempts = 3, baseDelayMs = 2000, onRetry } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (attempt >= maxAttempts) throw err;
        if (onRetry) onRetry(attempt, err);
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Clear the in-memory stream-info cache. Pass a MAC to clear just one camera,
   * or omit to clear all.
   * @param {string} [deviceMac]
   */
  clearCameraStreamCache(deviceMac) {
    if (!this._streamInfoCache) return;
    if (!deviceMac) {
      this._streamInfoCache.clear();
      return;
    }
    for (const key of this._streamInfoCache.keys()) {
      if (key.startsWith(`${deviceMac}:`)) this._streamInfoCache.delete(key);
    }
  }

  /**
   * Turn Plug 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async plugPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, value);
  }

  async plugTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "1");
  }

  async plugTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "0");
  }

  /**
   * Schedule the plug to turn on after `delaySeconds`.
   */
  async plugTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  }

  /**
   * Schedule the plug to turn off after `delaySeconds`.
   */
  async plugTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  }

  /**
   * Cancel any pending plug timer.
   */
  async clearPlugTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  }

  /**
   * Read the plug's active on/off timer (if any).
   */
  async getPlugTimer(deviceMac) {
    return this.getDeviceTimer(deviceMac);
  }

  /**
   * Energy usage records for a plug between two times.
   * @param {string} deviceMac
   * @param {Object} options
   * @param {Date|number} options.startTime
   * @param {Date|number} [options.endTime] — defaults to now
   */
  async getPlugUsageRecords(deviceMac, options = {}) {
    const { startTime, endTime = Date.now() } = options;
    if (startTime == null) {
      throw new Error("getPlugUsageRecords: `startTime` is required");
    }
    const data = {
      device_mac: deviceMac,
      date_begin: startTime instanceof Date ? startTime.getTime() : startTime,
      date_end: endTime instanceof Date ? endTime.getTime() : endTime,
    };
    const result = await this.request("app/v2/plug/usage_record_list", data);
    return result.data;
  }

  //WyzeLight
  /**
   * Turn Light Bulb 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async lightPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, value);
  }

  async lightTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "1");
  }

  async lightTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "0");
  }

  async lightTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  }

  async lightTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  }

  async clearLightTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  }

  // Convenience aliases — bulb-named timers (same wire as light timers).
  async bulbTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  }

  async bulbTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  }

  async clearBulbTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  }

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.BRIGHTNESS, value);
  }

  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
  }

  // Bulb / light lookup + feature setters. Power, brightness, color temp, hue/sat
  // already live above (lightTurnOn/Off, setBrightness, setColorTemperature,
  // lightMesh*, setMeshHue/Saturation).

  /**
   * Filter the device list down to bulbs/lights/strips (any product_model in
   * DeviceModels.BULB — covers white, mesh-color, and light strips).
   */
  async getBulbDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => types.DeviceModels.BULB.includes(d.product_model));
  }

  /**
   * Look up a single bulb by mac.
   * @param {string} mac
   */
  async getBulb(mac) {
    const bulbs = await this.getBulbDeviceList();
    return bulbs.find((d) => d.mac === mac);
  }

  /**
   * Combined snapshot of a bulb — list entry merged with its property list.
   * Tolerates a missing property list (logs a warning, returns the
   * list-entry alone).
   *
   * @param {string} mac
   * @returns {Promise<Object|null>}
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
  }

  /**
   * Toggle Sun Match — bulb mimics natural sunlight color temperature
   * throughout the day. P1528 = "1" (on) / "0" (off).
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} enabled
   */
  async setBulbSunMatch(deviceMac, deviceModel, enabled) {
    const value = enabled ? "1" : "0";
    // Mesh color bulbs (WLPA19C) need sun_match via set_property_list
    // (plural) — set_property (singular) silently no-ops for them.
    // Light strips and white bulbs work fine with set_property.
    if (
      types.DeviceModels.MESH_BULB.includes(deviceModel) &&
      !types.DeviceModels.LIGHT_STRIP.includes(deviceModel)
    ) {
      return this.setPropertyList(deviceMac, deviceModel, [
        { pid: PIDs.SUN_MATCH, pvalue: value },
      ]);
    }
    return this.setProperty(deviceMac, deviceModel, PIDs.SUN_MATCH, value);
  }

  /**
   * Toggle music-sync mode on a light strip. Writes P1535. Independent of
   * the broader `setBulbEffect` (which writes the full effect plist).
   * @param {string} deviceMac
   * @param {string} deviceModel — must be a light strip
   */
  async setBulbMusicMode(deviceMac, deviceModel, enabled) {
    if (!types.DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
      throw new Error(`setBulbMusicMode: ${deviceModel} is not a light strip`);
    }
    return this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.MUSIC_MODE,
      enabled ? "1" : "0",
      "set_mesh_property"
    );
  }

  async bulbMusicModeOn(device) {
    return this.setBulbMusicMode(device.mac, device.product_model, true);
  }

  async bulbMusicModeOff(device) {
    return this.setBulbMusicMode(device.mac, device.product_model, false);
  }

  /**
   * Try a local LAN command on a bulb first, fall back to a cloud action
   * on failure. Mirrors the local-first flow used by some bridge/proxy
   * tools — fast on-LAN response when available, cloud safety net when
   * not.
   *
   * The bulb device object must include `enr` (encrypted device key) and
   * `device_params.ip` — both come from `getObjectList()` / `getDeviceList()`.
   *
   * @param {Object} device — full device object from getDeviceList()
   * @param {string} propertyId — e.g. PIDs.ON
   * @param {string|number} propertyValue
   * @param {string} actionKey — e.g. "set_mesh_property"
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
          propertyValue,
          actionKey
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
  }

  /**
   * Set what the bulb does after a power outage — turn back on, or restore
   * the previous on/off state. P1509 with `LightPowerLossRecoveryMode`.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} mode — see `WyzeAPI.LightPowerLossRecoveryMode` (POWER_ON=0, RESTORE_PREVIOUS_STATE=1)
   */
  async setBulbPowerLossRecovery(deviceMac, deviceModel, mode) {
    return this.setProperty(deviceMac, deviceModel, PIDs.POWER_LOSS_RECOVERY, String(mode));
  }

  /**
   * Disable away mode on a bulb. P1506 = "0".
   *
   * NOTE: only the OFF path is implemented. Enabling away mode requires a
   * generated `switch_rule` action with a randomized rule object (so the
   * lights mimic a lived-in home pattern); shipping a guess for that rule
   * could leave a real user with broken away-mode behavior. Tracking
   * separately.
   */
  async setBulbAwayModeOff(deviceMac, deviceModel) {
    return this.setProperty(deviceMac, deviceModel, PIDs.AWAY_MODE, "0");
  }

  /**
   * Build the prop-list payload for a light-strip visual effect.
   *
   * @param {Object} options
   * @param {string} options.model — `WyzeAPI.LightVisualEffectModel.*` value (id string)
   * @param {string} [options.runType] — `WyzeAPI.LightVisualEffectRunType.*` (only honored for direction-supporting models)
   * @param {boolean} [options.musicMode=false]
   * @param {number}  [options.speed=8] — 1-10
   * @param {number}  [options.sensitivity=100] — 0-100
   * @param {boolean} [options.autoColor=false]
   * @param {string}  [options.colorPalette="2961AF,B5267A,91FF6A"] — comma-separated HEX values
   * @param {string}  [options.rhythm="0"]
   * @returns {Array<{pid: string, pvalue: string}>}
   */
  buildLightVisualEffect(options) {
    const { model } = options;
    if (!Object.values(types.LightVisualEffectModel).includes(model)) {
      throw new Error(
        `buildLightVisualEffect: invalid model ${JSON.stringify(model)}`
      );
    }
    const runType = options.runType ?? null;
    if (runType !== null && !Object.values(types.LightVisualEffectRunType).includes(runType)) {
      throw new Error(
        `buildLightVisualEffect: invalid runType ${JSON.stringify(runType)}`
      );
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
    if (
      runType !== null &&
      types.LightVisualEffectModelsWithDirection.includes(model)
    ) {
      plist.push({ pid: PIDs.LAMP_WITH_MUSIC_TYPE, pvalue: runType });
    }
    return plist;
  }

  /**
   * Set a visual / scene effect on a light strip. Only valid for light-strip
   * models (`HL_LSL`, `HL_LSLP`). Sends the effect plist plus a flip of
   * P1508 to FRAGMENTED so the strip enters scene mode.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {Object} effectOptions — see `buildLightVisualEffect()`
   */
  async setBulbEffect(deviceMac, deviceModel, effectOptions) {
    if (!types.DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
      throw new Error(
        `setBulbEffect: ${deviceModel} is not a light strip`
      );
    }
    const plist = this.buildLightVisualEffect(effectOptions);
    plist.push({
      pid: PIDs.CONTROL_LIGHT,
      pvalue: String(types.LightControlMode.FRAGMENTED),
    });
    return this.runActionListMulti(deviceMac, deviceModel, plist, "set_mesh_property");
  }

  /**
   * Set a color on a mesh bulb / color light strip.
   *
   * - Mesh color bulb (`WLPA19C`): writes P1507.
   * - Light Strip (`HL_LSL`): writes P1507 + flips P1508 → COLOR.
   * - Light Strip Pro (`HL_LSLP`):
   *   - `hex` is a string → replicates to all 16 subsections (P1515) + flips P1508.
   *   - `hex` is an array of 16 strings → uses each per-subsection color.
   *
   * Pro uses P1515 (subsection map) and skips P1507 — matching what the
   * official client sends.
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {string|string[]} hex — `"FF5733"` or array of 16 HEX strings
   */
  async setBulbColor(deviceMac, deviceModel, hex) {
    if (!types.DeviceModels.MESH_BULB.includes(deviceModel)) {
      throw new Error(`setBulbColor: ${deviceModel} does not support color`);
    }
    const isPro = types.DeviceModels.LIGHT_STRIP_PRO.includes(deviceModel);
    const isStrip = types.DeviceModels.LIGHT_STRIP.includes(deviceModel);

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
          { pid: PIDs.CONTROL_LIGHT, pvalue: String(types.LightControlMode.COLOR) },
        ],
        "set_mesh_property"
      );
    }

    validateHex(hex);
    const color = hex.toUpperCase();

    if (isPro) {
      // Replicate single color across all 16 subsections.
      const subsectionValue = "00" + Array(16).fill(color).join("#00");
      return this.runActionListMulti(
        deviceMac,
        deviceModel,
        [
          { pid: PIDs.LIGHTSTRIP_PRO_SUBSECTION, pvalue: subsectionValue },
          { pid: PIDs.CONTROL_LIGHT, pvalue: String(types.LightControlMode.COLOR) },
        ],
        "set_mesh_property"
      );
    }

    // Mesh color bulb or non-Pro light strip: P1507 + (for strips) control mode.
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, color, "set_mesh_property");
    if (isStrip) {
      await this.runActionList(
        deviceMac,
        deviceModel,
        PIDs.CONTROL_LIGHT,
        types.LightControlMode.COLOR,
        "set_mesh_property"
      );
    }
  }

  /**
   * Set color temperature, with strip-aware control-mode flip.
   * Writes P1502 and (for light strips) flips P1508 to TEMPERATURE so a
   * strip currently in COLOR or FRAGMENTED mode switches to white-CCT.
   */
  async setBulbColorTemperature(deviceMac, deviceModel, value) {
    if (types.DeviceModels.MESH_BULB.includes(deviceModel)) {
      await this.runActionList(deviceMac, deviceModel, PIDs.COLOR_TEMP, value, "set_mesh_property");
      if (types.DeviceModels.LIGHT_STRIP.includes(deviceModel)) {
        await this.runActionList(
          deviceMac,
          deviceModel,
          PIDs.CONTROL_LIGHT,
          types.LightControlMode.TEMPERATURE,
          "set_mesh_property"
        );
      }
      return;
    }
    return this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
  }

  // Bulb device-object helpers (homebridge-style — accept a device object).

  async bulbInfo(device) {
    return this.getBulbInfo(device.mac);
  }

  async bulbSunMatch(device, enabled) {
    return this.setBulbSunMatch(device.mac, device.product_model, enabled);
  }

  async bulbSunMatchOn(device) {
    return this.setBulbSunMatch(device.mac, device.product_model, true);
  }

  async bulbSunMatchOff(device) {
    return this.setBulbSunMatch(device.mac, device.product_model, false);
  }

  async bulbPowerLossRecovery(device, mode) {
    return this.setBulbPowerLossRecovery(device.mac, device.product_model, mode);
  }

  async bulbColor(device, hex) {
    return this.setBulbColor(device.mac, device.product_model, hex);
  }

  async bulbColorTemperature(device, value) {
    return this.setBulbColorTemperature(device.mac, device.product_model, value);
  }

  async bulbAwayModeOff(device) {
    return this.setBulbAwayModeOff(device.mac, device.product_model);
  }

  async bulbEffect(device, effectOptions) {
    return this.setBulbEffect(device.mac, device.product_model, effectOptions);
  }

  /**
   * Turn Mesh Device on or off
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async lightMeshPower(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.ON,
      value,
      "set_mesh_property"
    );
  }

  /**
   * Turn Mesh Device On
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async lightMeshOn(deviceMac, deviceModel) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.ON,
      "1",
      "set_mesh_property"
    );
  }

  /**
   * Turn Mesh Device Off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async lightMeshOff(deviceMac, deviceModel) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.ON,
      "0",
      "set_mesh_property"
    );
  }

  /**
   * Set Mesh Brightness 0 - 100
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async setMeshBrightness(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.BRIGHTNESS,
      value,
      "set_mesh_property"
    );
  }

  /**
   * Set Color Temperature 2700 - 6500
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async setMeshColorTemperature(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.COLOR_TEMP,
      value,
      "set_mesh_property"
    );
  }

  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {*} value
   */
  async setMeshHue(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.COLOR,
      value,
      "set_mesh_property"
    );
  }

  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {*} value
   */
  async setMeshSaturation(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      PIDs.COLOR,
      value,
      "set_mesh_property"
    );
  }

  /**
   * Turn wall switch on or off
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async wallSwitchPower(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", value);
  }

  /**
   * Turn wall switch on
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchPowerOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", true);
  }

  /**
   * Turn wall switch off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchPowerOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", false);
  }

  async wallSwitchPowerOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  }

  async wallSwitchPowerOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  }

  async clearWallSwitchTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  }

  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async wallSwitchIot(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", value);
  }

  async wallSwitchIotOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", true);
  }

  async wallSwitchIotOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", false);
  }

  async wallSwitchLedStateOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", true);
  }

  async wallSwitchLedStateOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", false);
  }

  /**
   * Wall Switch Turn Vacation Mode on
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchVacationModeOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 0);
  }

  /**
   * Wall Switch Turn Vacation Mode off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchVacationModeOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 1);
  }

  // Wall-switch press-type customization. The smart wall switch can route
  // single/double/triple/long-press to different IoT actions independently
  // of the load. Each prop takes an integer action id; the master toggle
  // `additional_interaction_switch` controls whether the press handlers run.

  async setWallSwitchSinglePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "single_press_type", value);
  }

  async setWallSwitchDoublePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "double_press_type", value);
  }

  async setWallSwitchTriplePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "triple_press_type", value);
  }

  async setWallSwitchLongPressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "long_press_type", value);
  }

  /**
   * Master toggle for press-type customization. When false, single/double/
   * triple/long-press fall back to the default load-switching behavior.
   */
  async setWallSwitchPressTypesEnabled(deviceMac, deviceModel, enabled) {
    return this.setIotProp(deviceMac, deviceModel, "additional_interaction_switch", Boolean(enabled));
  }

  async getHmsID() {
    await this.getPlanBindingListByUser();
  }

  async setHMSState(hms_id, mode) {
    if (mode == "off") {
      await this.disableRemeAlarm(hms_id);
      await this.monitoringProfileActive(hms_id, 0, 0);
    } else if (mode === "away") {
      await this.monitoringProfileActive(hms_id, 0, 1);
    } else if (mode === "home") {
      await this.monitoringProfileActive(hms_id, 1, 0);
    }
  }

  async getHmsUpdate(hms_id) {
    return await this.monitoringProfileStateStatus(hms_id);
  }

  async getDeviceState(device) {
    let state =
      device.device_params.power_switch !== undefined
        ? device.device_params.power_switch === 1
          ? "on"
          : "off"
        : "";
    if (!state) {
      state =
        device.device_params.open_close_state !== undefined
          ? device.device_params.open_close_state === 1
            ? "open"
            : "closed"
          : "";
    }
    return state;
  }

  /**
   * Retrieves the state of a device property identified by its PID.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {number} pid - The property ID to look for.
   * @return {Promise<number|string>} A promise that resolves to:
   *   - 1 if the property value is "1",
   *   - 0 if the property value is anything other than "1",
   *   - An empty string if the property value is undefined,
   *   - or undefined if the PID is not found.
   */
  async getDeviceStatePID(deviceMac, deviceModel, pid) {
    const prop = await this.getDevicePID(deviceMac, deviceModel);
    for (const property of prop.data.property_list) {
      if (pid == property.pid) {
        return property.value !== undefined
          ? property.value === "1"
            ? 1
            : 0
          : "";
      }
    }
  }

};

// Mixin pure helpers + cross-cutting accessors + service helpers onto the
// prototype. Service mixins must come before any device-family modules
// that depend on them (those will be added below as they get extracted).
Object.assign(
  module.exports.prototype,
  require("./shared/helpers"),
  require("./shared/accessors"),
  require("./services/olive"),
  require("./services/hms"),
  require("./services/ford"),
  require("./services/venus"),
  require("./services/iot3"),
  require("./services/devicemgmt")
);

/**
 * Camera stream lifecycle states. Numeric values mirror docker-wyze-bridge's
 * StreamStatus so they can be used interchangeably with that ecosystem.
 */
module.exports.StreamStatus = Object.freeze({
  OFFLINE: -90,
  STOPPING: -1,
  DISABLED: 0,
  STOPPED: 1,
  CONNECTING: 2,
  CONNECTED: 3,
});

module.exports.VacuumControlType = types.VacuumControlType;
module.exports.VacuumControlValue = types.VacuumControlValue;
module.exports.VacuumStatus = types.VacuumStatus;
module.exports.VacuumSuctionLevel = types.VacuumSuctionLevel;
module.exports.VacuumPreferenceType = types.VacuumPreferenceType;
module.exports.VacuumModeCodes = types.VacuumModeCodes;
module.exports.parseVacuumMode = types.parseVacuumMode;
module.exports.VacuumFaultCode = types.VacuumFaultCode;
module.exports.VacuumIotPropKeys = types.VacuumIotPropKeys;
module.exports.VacuumDeviceInfoKeys = types.VacuumDeviceInfoKeys;
module.exports.VenusDotArg1 = types.VenusDotArg1;
module.exports.VenusDotArg2 = types.VenusDotArg2;
module.exports.VenusDotArg3 = types.VenusDotArg3;
module.exports.VacuumControlTypeDescription = types.VacuumControlTypeDescription;
module.exports.LockStatusType = types.LockStatusType;
module.exports.LockStatusDescription = types.LockStatusDescription;
module.exports.parseLockStatus = types.parseLockStatus;
module.exports.LockEventType = types.LockEventType;
module.exports.LockEventTypeDescription = types.LockEventTypeDescription;
module.exports.parseLockEventType = types.parseLockEventType;
module.exports.LockEventSourceCodes = types.LockEventSourceCodes;
module.exports.LockEventSourceDescription = types.LockEventSourceDescription;
module.exports.parseLockEventSource = types.parseLockEventSource;
module.exports.LockVolumeLevel = types.LockVolumeLevel;
module.exports.LockLeftOpenTime = types.LockLeftOpenTime;
module.exports.LockKeyType = types.LockKeyType;
module.exports.LockKeyState = types.LockKeyState;
module.exports.LockKeyOperation = types.LockKeyOperation;
module.exports.LockKeyOperationStage = types.LockKeyOperationStage;
module.exports.LockKeyPermissionType = types.LockKeyPermissionType;
module.exports.LightControlMode = types.LightControlMode;
module.exports.LightPowerLossRecoveryMode = types.LightPowerLossRecoveryMode;
module.exports.LightVisualEffectModel = types.LightVisualEffectModel;
module.exports.LightVisualEffectRunType = types.LightVisualEffectRunType;
module.exports.LightVisualEffectModelsWithDirection = types.LightVisualEffectModelsWithDirection;
module.exports.ThermostatSystemMode = types.ThermostatSystemMode;
module.exports.ThermostatFanMode = types.ThermostatFanMode;
module.exports.ThermostatScenarioType = types.ThermostatScenarioType;
module.exports.ThermostatWorkingState = types.ThermostatWorkingState;
module.exports.ThermostatTempUnit = types.ThermostatTempUnit;
module.exports.ThermostatComfortBalanceMode = types.ThermostatComfortBalanceMode;
module.exports.ThermostatComfortBalanceDescription = types.ThermostatComfortBalanceDescription;
module.exports.RoomSensorBatteryLevel = types.RoomSensorBatteryLevel;
module.exports.RoomSensorStatusType = types.RoomSensorStatusType;
module.exports.RoomSensorStateType = types.RoomSensorStateType;
module.exports.HVACState = types.HVACState;
module.exports.HMSStatus = types.HMSStatus;
module.exports.DeviceMgmtToggleProps = types.DeviceMgmtToggleProps;
module.exports.IrrigationCropType = types.IrrigationCropType;
module.exports.IrrigationExposureType = types.IrrigationExposureType;
module.exports.IrrigationNozzleType = types.IrrigationNozzleType;
module.exports.IrrigationSlopeType = types.IrrigationSlopeType;
module.exports.IrrigationSoilType = types.IrrigationSoilType;
