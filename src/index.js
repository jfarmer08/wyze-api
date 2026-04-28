//v0.2.0.0 Update on new releases

const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const getUuid = require("uuid-by-string");
const payloadFactory = require("./utils/payloadFactory");
const crypto = require("./utils/crypto");
const constants = require("./constants");
const util = require("./util");
const cameraStreamCapture = require("./devices/cameraStreamCapture");
const types = require("./types");
const { installRedirectGuard, WYZE_ALLOWED_HOSTNAMES } = require("./util/security");

// Install once at module load: blocks redirects on any axios request bound for
// known Wyze hostnames so a 3xx can never silently send the bearer token to
// another host. Other axios consumers in the same process aren't affected.
installRedirectGuard();

const { propertyIds: PIDs } = types;

const { WyzeLogger, LEVELS: LOG_LEVELS } = require("./util/wyzeLogger");

module.exports = class WyzeAPI {
  // The optional second arg is ignored — kept only so existing callers
  // that pass a homebridge log don't break. The API uses its own
  // WyzeLogger so its output is formatted to look like a homebridge log
  // line and color-codes the level tag, independently of whatever the
  // homebridge plugin layer does with its own log object.
  constructor(options /*, log [unused] */) {
    // Resolve effective log level. apiLogEnabled is the legacy option —
    // honored for back-compat: true → debug, false/unset → info.
    const requestedLevel = options.logLevel
      ? String(options.logLevel).toLowerCase()
      : (options.apiLogEnabled ? "debug" : "info");
    this.logLevel = LOG_LEVELS[requestedLevel] != null ? requestedLevel : "info";

    this.log = new WyzeLogger({
      level: this.logLevel,
      prefix: options.logPrefix || "Wyze API",
      // Opt-in escape hatch for users who need raw payloads in their own
      // debug captures. Off by default — never set true in shared logs.
      redact: options.disableLogRedaction !== true,
    });
    this.persistPath = options.persistPath;
    this.refreshTokenTimerEnabled = options.refreshTokenTimerEnabled || false;
    this.lowBatteryPercentage = options.lowBatteryPercentage || 30;
    // User login parameters
    this.username = options.username;
    this.password = options.password;
    this.mfaCode = options.mfaCode;
    this.apiKey = options.apiKey;
    this.keyId = options.keyId;

    // Legacy "log everything" toggle. Kept on the instance because some
    // device modules still gate dumps with `if (this.apiLogEnabled)`.
    // The new logLevel === "debug" check below is preferred.
    this.apiLogEnabled = options.apiLogEnabled || this.logLevel === "debug";

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

    // Log every outgoing request at debug level — full config dump is
    // verbose and only useful when actively debugging. Suppressed unless
    // logLevel is "debug" (or legacy apiLogEnabled is true).
    this.log.debug(`Performing request: ${JSON.stringify(config)}`);

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
    // One-shot dump triggered by setting this.dumpData=true elsewhere —
    // keep at info level since it's an explicit user request.
    if (this.dumpData) {
      this.dumpData = false;
      this.log.info(
        `API response PerformRequest: ${JSON.stringify(
          result.data,
          (key, val) => (key.includes("token") ? "*******" : val)
        )}`
      );
      return;
    }
    // Routine response dumps — debug-level only.
    this.log.debug(
      `API response PerformRequest: ${JSON.stringify({
        url,
        status: result.status,
        data: result.data,
        headers: result.headers,
      })}`
    );
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
        // Critical — about to throttle. Always surface as warn.
        const resetsIn = rateLimitResetBy - Date.now();
        this.log.warn(
          `API rate limit remaining: ${rateLimitRemaining} — sleeping until reset in ${resetsIn}ms`
        );
        await this.sleepMilliSecounds(resetsIn);
      } else if (rateLimitRemaining !== undefined) {
        // Normal remaining-count — info-level so users can see it without
        // enabling debug. Filtered out at warn / error if log volume matters.
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
      // Login is a noteworthy lifecycle event — surface at info so users
      // can see "yes, the plugin is talking to Wyze" without enabling debug.
      this.log.info("Successfully logged into Wyze API");
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
          this.log.debug(
        `Last login: ${this.lastLoginAttempt}, Debounce: ${this.loginAttemptDebounceMilliseconds} ms, Now: ${now}`
      );
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
                  this.log.debug(`Persisting tokens @ ${tokenPath}`);
        // Ensure the persist directory exists. HOOBS doesn't pre-create
        // its own /var/lib/hoobs/.../persist dir, so the first write
        // here was throwing ENOENT and the plugin never recovered.
        await fs.mkdir(path.dirname(tokenPath), { recursive: true });
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

    this.log.debug(`run_action Data Body: ${JSON.stringify(data)}`);

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

          this.log.debug(`runActionList Request Data: ${JSON.stringify(data)}`);

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
          this.log.debug(`runActionListMulti Request Data: ${JSON.stringify(data)}`);
    const result = await this.request("app/v2/auto/run_action_list", data);
    return result.data;
  }

  async getIotProp(deviceMac) {
    const keys = "iot_state,switch-power,switch-iot,single_press_type,double_press_type,triple_press_type,long_press_type,palm-state";
    const payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    return this._oliveSignedGet(
      `${constants.siriusBaseUrl}/plugin/sirius/get_iot_prop`,
      payload,
      "GetIotProp"
    );
  }

  async setIotProp(deviceMac, product_model, propKey, value) {
    const payload = payloadFactory.oliveCreatePostPayload(deviceMac, product_model, propKey, value);
    return this._oliveSignedPost(
      `${constants.siriusBaseUrl}/plugin/sirius/set_iot_prop_by_topic`,
      payload,
      "SetIotProp"
    );
  }

  async getUserProfile() {
    const payload = payloadFactory.oliveCreateUserInfoPayload();
    return this._oliveSignedGet(
      `${constants.platformBaseUrl}/app/v2/platform/get_user_profile`,
      payload,
      "GetUserProfile"
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
  async localBulbCommand(deviceMac, deviceModel, deviceEnr, deviceIp, propertyId, propertyValue) {
    const characteristics = {
      mac: deviceMac.toUpperCase(),
      index: "1",
      ts: Date.now(),
      plist: [{ pid: propertyId, pvalue: String(propertyValue) }],
    };

    const characteristicsStr = JSON.stringify(characteristics);
    const characteristicsEnc = util.wyzeEncrypt(deviceEnr, characteristicsStr);
    const payloadStr = JSON.stringify({
      request: "set_status",
      isSendQueue: 0,
      characteristics: characteristicsEnc,
    }).replace(/\\\\/g, "\\");

    const url = `http://${deviceIp}:88/device_request`;
    this.log.debug(`localBulbCommand: ${url}`);

    const response = await axios.post(url, payloadStr, {
      headers: { "Content-Type": "application/json" },
    });

          this.log.debug(`localBulbCommand response from ${deviceMac}: ${JSON.stringify(response.data)}`);
    return response.data;
  }

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
  require("./shared/homekit"),
  require("./services/olive"),
  require("./services/hms"),
  require("./services/ford"),
  require("./services/venus"),
  require("./services/iot3"),
  require("./services/devicemgmt"),
  require("./devices/vacuum"),
  require("./devices/vacuum.helpers"),
  require("./devices/sensors"),
  require("./devices/sensors.helpers"),
  require("./devices/irrigation"),
  require("./devices/irrigation.helpers"),
  require("./devices/hms"),
  require("./devices/hms.helpers"),
  require("./devices/thermostat"),
  require("./devices/thermostat.helpers"),
  require("./devices/plugs"),
  require("./devices/plugs.helpers"),
  require("./devices/switches"),
  require("./devices/switches.helpers"),
  require("./devices/bulbs"),
  require("./devices/bulbs.helpers"),
  require("./devices/locks"),
  require("./devices/locks.helpers"),
  require("./devices/cameras"),
  require("./devices/cameras.helpers")
);

// Preserve previously-static thermostat key getters as class statics.
const _thermostat = require("./devices/thermostat");
module.exports.THERMOSTAT_DEVICE_INFO_KEYS = _thermostat.THERMOSTAT_DEVICE_INFO_KEYS;
module.exports.ROOM_SENSOR_PROP_KEYS = _thermostat.ROOM_SENSOR_PROP_KEYS;

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
module.exports.WYZE_ALLOWED_HOSTNAMES = WYZE_ALLOWED_HOSTNAMES;
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
module.exports.propertyIds = types.propertyIds;
module.exports.WyzeAccessoryModels = types.WyzeAccessoryModels;
module.exports.DeviceModels = types.DeviceModels;
