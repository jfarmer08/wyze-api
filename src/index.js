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

  async controlLock(deviceMac, deviceModel, action) {
    await this.maybeLogin();

    const path = "/openapi/lock/v1/control";
    const uuid = this.getUuid(deviceMac, deviceModel);
    let payload = {
      uuid,
      action, // "remoteLock" or "remoteUnlock"
    };

    try {
      // Generate payload using the payloadFactory
      payload = payloadFactory.fordCreatePayload(
        this.access_token,
        payload,
        path,
        "post"
      );

      const urlPath = "https://yd-saas-toc.wyzecam.com/openapi/lock/v1/control";
      const result = await axios.post(urlPath, payload);

      if (this.apiLogEnabled) {
        this.log.info(`API response ControlLock: ${JSON.stringify(result.data)}`);
      }

      return result.data;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);

      if (error.response) {
        this.log.error(`Response ControlLock (${error.response.status} - ${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`);
      }

      throw error;
    }
  }

  async getLockInfo(deviceMac, deviceModel) {
    await this.maybeLogin();
    let url_path = "/openapi/lock/v1/info";
    let payload = {
      uuid: this.getUuid(deviceMac, deviceModel),
      with_keypad: "1",
    };
    try {
      let config = {
        params: payload,
      };
      payload = payloadFactory.fordCreatePayload(
        this.access_token,
        payload,
        url_path,
        "get"
      );

      const url = "https://yd-saas-toc.wyzecam.com/openapi/lock/v1/info";
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response GetLockInfo: ${JSON.stringify(result.data)}`
        );
      }
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        this.log.error(
          `Response GetLockInfo (${e.response.statusText}): ${JSON.stringify(
            e.response.data,
            null,
            "\t"
          )}`
        );
      }
      throw e;
    }
  }

  async getIotProp(deviceMac) {
    const keys = "iot_state,switch-power,switch-iot,single_press_type,double_press_type,triple_press_type,long_press_type,palm-state";

    await this.maybeLogin();

    const payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    const signature = crypto.oliveCreateSignature(payload, this.access_token);

    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };

    const url = "https://wyze-sirius-service.wyzecam.com/plugin/sirius/get_iot_prop";

    if (this.apiLogEnabled) {
      this.log.info(`Performing request: ${url}`);
    }

    try {
      const result = await axios.get(url, config);

      if (this.apiLogEnabled) {
        this.log.info(`API response GetIotProp: ${JSON.stringify(result.data)}`);
      }

      return result.data;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);

      if (error.response) {
        this.log.error(
          `Response GetIotProp (${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`
        );
      }

      throw error;
    }
  }

  async setIotProp(deviceMac, product_model, propKey, value) {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreatePostPayload(
      deviceMac,
      product_model,
      propKey,
      value
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );

    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url =
        "https://wyze-sirius-service.wyzecam.com/plugin/sirius/set_iot_prop_by_topic";
      const result = await axios.post(url, JSON.stringify(payload), config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response SetIotProp: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        this.log.error(
          `Response SetIotProp (${e.response.statusText}): ${JSON.stringify(
            e.response.data,
            null,
            "\t"
          )}`
        );
      }
      throw e;
    }
  }

  async getUserProfile() {
    await this.maybeLogin();

    let payload = payloadFactory.oliveCreateUserInfoPayload();
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url =
        "https://wyze-platform-service.wyzecam.com/app/v2/platform/get_user_profile";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response GetUserProfile: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response GetUserProfile (${e.response.statusText}): ${JSON.stringify(
            e.response.data,
            null,
            "\t"
          )}`
        );
      }
      throw e;
    }
  }

  async disableRemeAlarm(hms_id) {
    await this.maybeLogin();
    let config = {
      headers: {
        Authorization: this.access_token,
        "User-Agent": this.userAgent,
      },
      data: {
        hms_id: hms_id,
        remediation_id: "emergency",
      },
    };
    try {
      const url = "https://hms.api.wyze.com/api/v1/reme-alarm";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.delete(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response DisableRemeAlarm: ${JSON.stringify(result.data)}`
        );
      }
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response && this.apiLogEnabled) {
        this.log.error(
          `Response DisableRemeAlarm (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async getPlanBindingListByUser() {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreateHmsPayload();
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };

    try {
      const url =
        "https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response GetPlanBindingListByUser: ${JSON.stringify(
            result.data
          )}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        this.log.error(
          `Response GetPlanBindingListByUser (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async monitoringProfileStateStatus(hms_id) {
    await this.maybeLogin();
    let query = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    let signature = crypto.oliveCreateSignature(query, this.access_token);
    let config = {
      headers: {
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
        Authorization: this.access_token,
        "Content-Type": "application/json",
      },
      params: query,
    };

    try {
      const url =
        "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response MonitoringProfileStateStatus: ${JSON.stringify(
            result.data
          )}`
        );
      }
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response MonitoringProfileStateStatus (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async monitoringProfileActive(hms_id, home, away) {
    await this.maybeLogin();
    const payload = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const signature = crypto.oliveCreateSignature(payload, this.access_token);

    const config = {
      headers: {
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: constants.phoneId,
        access_token: this.access_token,
        signature2: signature,
        Authorization: this.access_token,
      },
      params: payload,
    };

    const data = [
      {
        state: "home",
        active: home,
      },
      {
        state: "away",
        active: away,
      },
    ];

    try {
      const url =
        "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/active";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.patch(url, data, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response MonitoringProfileActive: ${JSON.stringify(result.data)}`
        );
      }
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response MonitoringProfileActive (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async thermostatGetIotProp(deviceMac) {
    await this.maybeLogin();
    let keys =
      "trigger_off_val,emheat,temperature,humidity,time2temp_val,protect_time,mode_sys,heat_sp,cool_sp, current_scenario,config_scenario,temp_unit,fan_mode,iot_state,w_city_id,w_lat,w_lon,working_state, dev_hold,dev_holdtime,asw_hold,app_version,setup_state,wiring_logic_id,save_comfort_balance, kid_lock,calibrate_humidity,calibrate_temperature,fancirc_time,query_schedule";
    let payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: constants.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url =
        "https://wyze-earth-service.wyzecam.com/plugin/earth/get_iot_prop";
      if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response ThermostatGetIotProp: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response ThermostatGetIotProp (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async thermostatSetIotProp(deviceMac, deviceModel, propKey, value) {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreatePostPayload(
      deviceMac,
      deviceModel,
      propKey,
      value
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url =
        "https://wyze-earth-service.wyzecam.com/plugin/earth/set_iot_prop_by_topic";
      const result = await axios.post(url, JSON.stringify(payload), config);
      if (this.apiLogEnabled) {
        this.log.info(
          `API response ThermostatSetIotProp: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response ThermostatSetIotProp (${e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

    // Construct the characteristics object
  async irrigationGetIotProp(deviceMac) {
    await this.maybeLogin();
    let keys =
      "zone_state,iot_state,iot_state_update_time,app_version,RSSI,wifi_mac,sn,device_model,ssid,IP";
    let payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys = keys;
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url = `${constants.irrigationBaseUrl}get_iot_prop`;
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
          `API response IrrigationGetIotProp: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationGetIotProp (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async irrigationGetDeviceInfo(deviceMac) {
    await this.maybeLogin();
    let keys =
      "wiring,sensor,enable_schedules,notification_enable,notification_watering_begins,notification_watering_ends,notification_watering_is_skipped,skip_low_temp,skip_wind,skip_rain,skip_saturation";
    let payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys = keys;
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url = `${constants.irrigationBaseUrl}device_info`;
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
          `API response IrrigationGetDeviceInfo: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationGetDeviceInfo (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async irrigationGetZones(deviceMac) {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url = `${constants.irrigationBaseUrl}zone`;
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
          `API response IrrigationGetZones: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationGetZones (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async irrigationQuickRun(deviceMac, zoneNumber, duration) {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreatePostPayloadIrrigationQuickRun(
      deviceMac,
      zoneNumber,
      duration
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url = `${constants.irrigationBaseUrl}quickrun`;
      const result = await axios.post(url, JSON.stringify(payload), config);
      if (this.apiLogEnabled) {
        this.log(
          `API response IrrigationQuickRun: ${JSON.stringify(result.data)}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationQuickRun (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async irrigationStop(deviceMac) {
    await this.maybeLogin();
    let payload = payloadFactory.oliveCreatePostPayloadIrrigationStop(
      deviceMac,
      "STOP"
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url = `${constants.irrigationBaseUrl}runningschedule`;
      const result = await axios.post(url, JSON.stringify(payload), config);
      if (this.apiLogEnabled) {
        this.log(`API response IrrigationStop: ${JSON.stringify(result.data)}`);
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationStop (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
  }

  async irrigationGetScheduleRuns(deviceMac, limit = 2) {
    await this.maybeLogin();
    let payload =
      payloadFactory.oliveCreateGetPayloadIrrigationScheduleRuns(deviceMac);
    payload.limit = limit;
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      const url = `${constants.irrigationBaseUrl}schedule_runs`;
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
          `API response IrrigationGetScheduleRuns: ${JSON.stringify(
            result.data
          )}`
        );
      }

      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        this.log.error(
          `Response IrrigationGetScheduleRuns (${
            e.response.statusText
          }): ${JSON.stringify(e.response.data, null, "\t")}`
        );
      }
      throw e;
    }
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

  // Wyze Robot Vacuum (Venus service) — JA_RO2.
  //
  // Auth/signing scheme (different from olive/earth/web): per request,
  //   nonce       = Date.now() (ms)
  //   requestid   = md5(md5(String(nonce)))
  //   signature2  = HMAC-MD5(key=md5(access_token + venusSigningSecret), body)
  // For POST: `nonce` (string) is injected into the JSON body before signing,
  // and the signed body is the no-whitespace JSON.stringify of that payload.
  // For GET: `nonce` (number) is added to params; the signed body is the
  // sorted "k=v&k=v" param string (raw values, no URL encoding).
  // Reference: wyze-sdk WpkNetServiceClient and VenusServiceClient.

  _venusBuildHeaders(nonce, signature) {
    return {
      "Accept-Encoding": "gzip",
      "User-Agent": this.userAgent,
      access_token: this.access_token,
      appid: constants.venusAppId,
      appinfo: this.appInfo,
      phoneid: this.phoneId,
      requestid: crypto.venusRequestId(nonce),
      signature2: signature,
    };
  }

  _venusSortedQuery(params) {
    return Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
  }

  async _venusRequest(method, path, payload = {}) {
    await this.maybeLogin();

    const nonce = Date.now();
    const url = `${constants.venusBaseUrl}${path}`;
    const verb = method.toUpperCase();

    let response;
    try {
      if (verb === "GET") {
        const params = { ...payload, nonce };
        const signature = crypto.venusGenerateDynamicSignature(
          this._venusSortedQuery(params),
          this.access_token
        );
        const headers = this._venusBuildHeaders(nonce, signature);
        if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
        response = await axios.get(url, { headers, params });
      } else {
        const body = { ...payload, nonce: String(nonce) };
        const bodyStr = JSON.stringify(body);
        const signature = crypto.venusGenerateDynamicSignature(bodyStr, this.access_token);
        const headers = {
          ...this._venusBuildHeaders(nonce, signature),
          "Content-Type": "application/json; charset=utf-8",
        };
        if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
        response = await axios.request({ url, method: verb, headers, data: bodyStr });
      }
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response Venus ${verb} ${path} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }

    if (this.apiLogEnabled) {
      this.log.info(`API response Venus ${verb} ${path}: ${JSON.stringify(response.data)}`);
    }
    return response.data;
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
   * Mirrors wyze-sdk's `info(device_mac)`.
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

  getUuid(deviceMac, deviceModel) {
    return deviceMac.replace(`${deviceModel}.`, "");
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

  async cameraPrivacy(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  }

  async cameraTurnOn(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "power_on");
  }

  async cameraTurnOff(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "power_off");
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
    await this.runAction(deviceMac, deviceModel, "siren_on");
  }

  /**
   * Turn Camera Siren OFF
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async cameraSirenOff(deviceMac, deviceModel) {
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

  // IoT3 API — used by Lock Bolt V2 (DX_LB2) and Palm lock (DX_PVLOC)

  _iot3ExtractModel(deviceMac, deviceModel) {
    if (deviceModel) return deviceModel;
    const parts = deviceMac.split("_");
    return parts.length >= 3 ? parts.slice(0, 2).join("_") : deviceMac;
  }

  _iot3BuildHeaders(bodyStr) {
    return {
      access_token: this.access_token,
      appid: this.oliveAppId,
      appinfo: constants.iot3AppInfo,
      appversion: constants.iot3AppVersion,
      env: "Prod",
      phoneid: this.phoneId,
      requestid: nodeCrypto.randomBytes(16).toString("hex"),
      Signature2: crypto.iot3CreateSignature(bodyStr, this.access_token),
      "Content-Type": "application/json; charset=utf-8",
    };
  }

  async _iot3Post(urlPath, payload) {
    const body = JSON.stringify(payload);
    const headers = this._iot3BuildHeaders(body);
    const url = `${constants.iot3BaseUrl}${urlPath}`;
    if (this.apiLogEnabled) {
      this.log.info(`Performing request: ${url}`);
    }
    try {
      const response = await axios.post(url, body, { headers });
      if (this.apiLogEnabled) {
        this.log.info(`API response IoT3 ${urlPath}: ${JSON.stringify(response.data)}`);
      }
      return response.data;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);
      if (error.response) {
        this.log.error(`Response IoT3 ${urlPath} (${error.response.status} - ${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`);
      }
      throw error;
    }
  }

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

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.BRIGHTNESS, value);
  }

  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
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

  /**
   * Gets the lock door state based on the device state value.
   *
   * @param {number} deviceState - The state value of the device.
   * @return {number} Returns 1 if the state value is 2 or higher; otherwise, returns the device state value.
   */
  getLockDoorState(deviceState) {
    if (deviceState >= 2) {
      return 1;
    } else {
      return deviceState;
    }
  }

  /**
   * Gets the leak sensor state based on the device state value.
   *
   * @param {number} deviceState - The state value of the device.
   * @return {number} Returns 1 if the state value is 2 or higher; otherwise, returns the device state value.
   */
  getLeakSensorState(deviceState) {
    if (deviceState >= 2) {
      return 1;
    } else {
      return deviceState;
    }
  }

  /**
   * Determines the lock state based on the device state value.
   *
   * @param {number} deviceState - The state value of the device.
   * @return {number} Returns 0 if the state value is 2; otherwise, returns 1.
   */
  getLockState(deviceState) {
    if (deviceState == 2) {
      return 0;
    } else {
      return 1;
    }
  }

  /**
   * Checks the battery voltage and ensures it is within a valid range.
   *
   * @param {number} value - The battery voltage to be checked.
   * @return {number} A value of 100 if the input is 100 or more; returns 1 if the input is undefined or null; otherwise, returns the input value.
   */
  checkBatteryVoltage(value) {
    if (value >= 100) {
      return 100;
    } else if (value === undefined || value === null) {
      return 1;
    } else {
      return value;
    }
  }

  /**
   * Checks if the battery voltage is below the defined low battery percentage threshold.
   *
   * @param {number} batteryVolts - The current battery voltage to be checked.
   * @return {number} Returns 1 if the battery voltage is less than or equal to the low battery percentage threshold; otherwise, returns 0.
   */
  checkLowBattery(batteryVolts) {
    if (this.checkBatteryVoltage(batteryVolts) <= this.lowBatteryPercentage) {
      return 1;
    } else {
      return 0;
    }
  }

  /**
   * Converts a value from a specified range to a normalized float between 0 and 1.
   *
   * @param {number} value - The value to be normalized.
   * @param {number} min - The minimum value of the original range.
   * @param {number} max - The maximum value of the original range.
   * @return {number} The normalized float value between 0 and 1.
   */
  rangeToFloat(value, min, max) {
    return (value - min) / (max - min);
  }

  /**
   * Converts a normalized float value between 0 and 1 to a value within a specified range.
   *
   * @param {number} value - The normalized float value between 0 and 1.
   * @param {number} min - The minimum value of the desired range.
   * @param {number} max - The maximum value of the desired range.
   * @return {number} The value within the specified range, rounded to the nearest integer.
   */
  floatToRange(value, min, max) {
    return Math.round(value * (max - min) + min);
  }

  /**
   * Converts a temperature value from Kelvin to Mired.
   *
   * @param {number} value - The temperature in Kelvin to be converted.
   * @return {number} The temperature in Mired, rounded to the nearest integer.
   */
  kelvinToMired(value) {
    return Math.round(1000000 / value);
  }

  /**
   * Checks if a brightness value is within the valid range (1 to 100).
   * 
   * @param {number} value - The brightness value to be checked.
   * @return {number} The original brightness value if it's within the valid range; otherwise, returns the same value (potentially unaltered logic).
   */
  checkBrightnessValue(value) {
    if (value >= 1 && value <= 100) {
      return value;
    } else {
      return value; // This logic might need adjustment to handle out-of-range values.
    }
  }

  /**
   * Ensures that a color temperature value is not below a minimum threshold.
   *
   * @param {number} color - The color temperature value to be checked.
   * @return {number} The color temperature value if it's 500 or above; otherwise, returns 500.
   */
  checkColorTemp(color) {
    if (color >= 500) {
      return color;
    } else {
      return 500;
    }
  }

  /**
   * Converts a temperature from Fahrenheit to Celsius.
   *
   * @param {number} fahrenheit - The temperature in Fahrenheit to be converted.
   * @return {number} The equivalent temperature in Celsius.
   */
  fahrenheit2celsius(fahrenheit) {
    return (fahrenheit - 32.0) / 1.8;
  }

  /**
   * Converts a temperature from Celsius to Fahrenheit.
   *
   * @param {number} celsius - The temperature in Celsius to be converted.
   * @return {number} The equivalent temperature in Fahrenheit.
   */
  celsius2fahrenheit(celsius) {
    return celsius * 1.8 + 32.0;
  }

  /**
   * Clamps a number within a specified range.
   *
   * @param {number} number - The number to be clamped.
   * @param {number} min - The minimum value to clamp to.
   * @param {number} max - The maximum value to clamp to.
   * @return {number} The clamped value, which is between min and max.
   */
  clamp(number, min, max) {
    return Math.max(min, Math.min(number, max));
  }

  /**
  * Sleep for a specified number of seconds.
  * @param {number} ms - The number of seconds to sleep.
  * @returns {Promise<void>} - A promise that resolves after the specified time.
  */
  sleepSeconds(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /**
  * Sleep for a specified number of milliseconds.
  * @param {number} ms - The number of milliseconds to sleep.
  * @returns {Promise<void>} - A promise that resolves after the specified time.
  */
  async sleepMilliSecounds(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

};

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
