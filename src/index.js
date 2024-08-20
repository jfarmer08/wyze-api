const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const getUuid = require("uuid-by-string");

const payloadFactory = require("./payloadFactory");
const crypto = require("./crypto");
const constants = require("./constants");
const util = require("./util");
const RokuAuthLib = require("./rokuAuth")

module.exports = class WyzeAPI {
  constructor(options, log) {
    this.log = log || console;
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
      this.log(`Waiting for ${retryAfterMs}ms before retrying`);
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
      this.log(`Performing request: ${JSON.stringify(config)}`);
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
      this.log(
        `API response PerformRequest: ${JSON.stringify(
          result.data,
          (key, val) => (key.includes("token") ? "*******" : val)
        )}`
      );
    } else if (this.apiLogEnabled) {
      this.log(
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
        this.log(
          `API rate limit remaining: ${rateLimitRemaining} - resets in ${resetsIn}ms`
        );
        await this.sleepMilliSecounds(resetsIn);
      } else if (rateLimitRemaining && this.apiLogEnabled) {
        this.log(
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

    if (code !== 1) {
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
        this.log("Successfully logged into Wyze API");
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
      this.log(
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
    this.log(
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
          this.log(`Retrying token refresh, attempt ${attempt}...`);
          // Wait before retrying
          await this.sleepSeconds(2); // Sleep for 2 seconds before retrying
        } else {
          this.log(`Error during token refresh: ${error.message}`);
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
      this.log(`Error updating tokens: ${error.message}`);
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
          this.log(`Persisting tokens @ ${tokenPath}`);
        }
        await fs.writeFile(tokenPath, JSON.stringify(data)); // Write tokens to the file.
        return; // Exit if successful.
      } catch (error) {
        attempt += 1;
        if (attempt < maxRetries) {
          this.log(`Retrying token persistence, attempt ${attempt}...`);
          // Wait before retrying
          await this.sleepSeconds(2); // Sleep for 2 seconds before retrying
        } else {
          this.log(`Error persisting tokens: ${error.message}`);
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
        this.log(`Error loading persisted tokens: ${error.message}`);
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
      this.log(`run_action Data Body: ${JSON.stringify(data)}`);

    const result = await this.request("app/v2/auto/run_action", data);
    return result.data;
  }

  async runActionList(deviceMac, deviceModel, propertyId, propertyValue, actionKey) {
    const plist = [
      { pid: propertyId, pvalue: String(propertyValue) }
    ];

    // Add default property if not already P3
    if (propertyId !== "P3") {
      plist.push({ pid: "P3", pvalue: "1" });
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
      this.log(`runActionList Request Data: ${JSON.stringify(data)}`);
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
        this.log(`API response ControlLock: ${JSON.stringify(result.data)}`);
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
        this.log(
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
    const keys = "iot_state,switch-power,switch-iot,single_press_type,double_press_type,triple_press_type,long_press_type";

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
      this.log(`Performing request: ${url}`);
    }

    try {
      const result = await axios.get(url, config);

      if (this.apiLogEnabled) {
        this.log(`API response GetIotProp: ${JSON.stringify(result.data)}`);
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
        "User-Agent": "myapp",
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
        this.log(
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
        "User-Agent": "myapp",
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.delete(url, config);
      if (this.apiLogEnabled) {
        this.log(
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.patch(url, data, config);
      if (this.apiLogEnabled) {
        this.log(
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
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      const result = await axios.get(url, config);
      if (this.apiLogEnabled) {
        this.log(
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
        "User-Agent": "myapp",
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
        this.log(
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
    // Log the start of the command process
    console.log(`Initiating local command for device ${deviceMac} (${deviceModel}).`);

    // Create a property list with the ID and value
    const plist = [
      { pid: propertyId, pvalue: String(propertyValue) }
    ];

    // Construct the characteristics object
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
      "P3",
      "1",
      "set_mesh_property"
    );
  }

  async turnMeshOff(deviceMac, deviceModel) {
    return await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      "0",
      "set_mesh_property"
    );
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

  /**
   * Sets the flood light property of a camera to a specified value.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @param {string} value - The value to set for the flood light property.
   * @return {Promise<void>} A promise that resolves when the property has been set.
   */
  async cameraFloodLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1056", value);
  }

  /**
   * Turns on the flood light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the flood light has been turned on.
   */
  async cameraFloodLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "1");
  }

  /**
   * Turns off the flood light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the flood light has been turned off.
   */
  async cameraFloodLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "2");
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
    await this.setProperty(deviceMac, deviceModel, "P1056", value);
  }

  /**
   * Turns on the spot light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the spot light has been turned on.
   */
  async cameraSpotLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "1");
  }

  /**
   * Turns off the spot light of a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when the spot light has been turned off.
   */
  async cameraSpotLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "2");
  }

  /**
   * Turns on motion detection for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion detection has been turned on.
   */
  async cameraMotionOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1001", 1);
  }

  /**
   * Turns off motion detection for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion detection has been turned off.
   */
  async cameraMotionOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1001", 0);
  }

  /**
   * Turns on sound notifications for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when sound notifications have been turned on.
   */
  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1048", "1");
  }

  /**
   * Turns off sound notifications for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when sound notifications have been turned off.
   */
  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1048", "0");
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
    await this.setProperty(deviceMac, deviceModel, "P1", value);
  }

  /**
   * Turns on camera notifications.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when notifications have been turned on.
   */
  async cameraNotificationsOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1", "1");
  }

  /**
   * Turns off camera notifications.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when notifications have been turned off.
   */
  async cameraNotificationsOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1", "0");
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
    await this.setProperty(deviceMac, deviceModel, "P1047", value);
  }

  /**
   * Turns on motion recording for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion recording has been turned on.
   */
  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1047", "1");
  }

  /**
   * Turns off motion recording for a camera.
   *
   * @param {string} deviceMac - The MAC address of the device.
   * @param {string} deviceModel - The model of the device.
   * @return {Promise<void>} A promise that resolves when motion recording has been turned off.
   */
  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1047", "0");
  }

  /**
   * Turn Plug 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async plugPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P3", value);
  }

  async plugTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "1");
  }

  async plugTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "0");
  }

  //WyzeLight
  /**
   * Turn Light Bulb 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async lightPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P3", value);
  }

  async lightTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "1");
  }

  async lightTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "0");
  }

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1501", value);
  }

  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1502", value);
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
      "P3",
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
      "P3",
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
      "P3",
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
      "P1501",
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
      "P1502",
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
      "P1507",
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
      "P1507",
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
