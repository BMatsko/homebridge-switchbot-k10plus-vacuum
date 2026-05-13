var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// index.ts
var import_crypto = __toESM(require("crypto"));
var PLATFORM_NAME = "SwitchBotK10PlusVacuum";
var PLUGIN_IDENTIFIER = "homebridge-switchbot-k10plus-vacuum";
var ACCESSORY_PREFIX = "SwitchBotK10PlusVacuum";
var SWITCHBOT_BASE_URL = "https://api.switch-bot.com";
var DEFAULT_POLL_INTERVAL_SECONDS = 300;
var MIN_POLL_INTERVAL_SECONDS = 60;
var LOW_BATTERY_THRESHOLD = 20;
var CLEANING_STATUSES = /* @__PURE__ */ new Set(["Cleaning", "Clearing", "Working", "Running"]);
var CHARGING_STATUSES = /* @__PURE__ */ new Set(["Charging", "FullyCharged"]);
var SwitchBotK10PlusVacuumPlatform = class {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.rooms = Array.isArray(config.rooms) ? config.rooms : [];
    this.powerLevels = Array.isArray(config.powerLevels) ? config.powerLevels : [];
    this.token = config.token;
    this.secret = config.secret;
    this.deviceId = config.deviceId;
    this.vacuumName = config.name || "SwitchBot K10+ Vacuum";
    this.enableStopSwitch = config.enableStopSwitch !== false;
    this.enableDockSwitch = config.enableDockSwitch !== false;
    this.pollIntervalSeconds = Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number(config.pollIntervalSeconds) || DEFAULT_POLL_INTERVAL_SECONDS
    );
    if (!this.token || !this.secret || !this.deviceId) {
      this.log.error("SwitchBot token, secret, and deviceId are required. No accessories will be registered.");
      return;
    }
    this.api.on("didFinishLaunching", () => {
      void this.discoverAccessories();
    });
    this.api.on("shutdown", () => {
      if (this.statusTimer) {
        clearInterval(this.statusTimer);
      }
    });
  }
  Service;
  Characteristic;
  accessories = /* @__PURE__ */ new Map();
  rooms;
  powerLevels;
  token;
  secret;
  deviceId;
  vacuumName;
  enableStopSwitch;
  enableDockSwitch;
  pollIntervalSeconds;
  statusTimer;
  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }
  async discoverAccessories() {
    const expectedUuids = /* @__PURE__ */ new Set();
    this.ensureAccessory(expectedUuids, "command-clean", "Clean", "command", {
      command: "start",
      includeStatusServices: true
    });
    if (this.enableStopSwitch) {
      this.ensureAccessory(expectedUuids, "command-stop", "Stop", "command", { command: "stop" });
    }
    if (this.enableDockSwitch) {
      this.ensureAccessory(expectedUuids, "command-dock", "Return to Dock", "command", { command: "dock" });
    }
    for (const powerLevel of this.powerLevels) {
      this.ensureAccessory(expectedUuids, `power-${powerLevel.value}`, powerLevel.name, "powerLevel", {
        powerLevel: powerLevel.value
      });
    }
    for (const room of this.rooms) {
      this.ensureAccessory(expectedUuids, `room-${room.sceneId}`, room.name, "room", { sceneId: room.sceneId });
    }
    this.unregisterStaleAccessories(expectedUuids);
    await this.updateVacuumStatus();
    this.startStatusPolling();
  }
  ensureAccessory(expectedUuids, uniqueSuffix, name, kind, options) {
    const uuid = this.api.hap.uuid.generate(`${ACCESSORY_PREFIX}-${this.deviceId}-${uniqueSuffix}`);
    expectedUuids.add(uuid);
    const existing = this.accessories.get(uuid);
    const accessory = existing ?? new this.api.platformAccessory(name, uuid);
    accessory.context.kind = kind;
    accessory.context.command = options.command;
    accessory.context.sceneId = options.sceneId;
    accessory.context.powerLevel = options.powerLevel;
    this.updateAccessoryInformation(accessory, name);
    this.configureSwitchService(accessory, name, kind, options);
    if (options.includeStatusServices) {
      this.configureStatusServices(accessory);
    }
    if (!existing) {
      this.api.registerPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }
  updateAccessoryInformation(accessory, name) {
    accessory.getService(this.Service.AccessoryInformation)?.setCharacteristic(this.Characteristic.Manufacturer, "SwitchBot").setCharacteristic(this.Characteristic.Model, "K10+ Vacuum").setCharacteristic(this.Characteristic.SerialNumber, this.deviceId).setCharacteristic(this.Characteristic.Name, name);
  }
  configureSwitchService(accessory, name, kind, options) {
    const service = accessory.getService(this.Service.Switch) ?? accessory.addService(this.Service.Switch, name);
    service.setCharacteristic(this.Characteristic.Name, name);
    service.getCharacteristic(this.Characteristic.On).removeAllListeners("set");
    service.getCharacteristic(this.Characteristic.On).onSet(async (value) => {
      if (!value) {
        return;
      }
      await this.handleSwitchOn(kind, options);
      setTimeout(() => service.updateCharacteristic(this.Characteristic.On, false), 1e3);
    });
  }
  configureStatusServices(accessory) {
    const batteryService = accessory.getService(this.Service.BatteryService) ?? accessory.addService(this.Service.BatteryService, `${this.vacuumName} Battery`, "battery");
    batteryService.setCharacteristic(this.Characteristic.Name, `${this.vacuumName} Battery`);
    const cleaningService = accessory.getServiceById(this.Service.OccupancySensor, "cleaning") ?? accessory.addService(this.Service.OccupancySensor, `${this.vacuumName} Cleaning`, "cleaning");
    cleaningService.setCharacteristic(this.Characteristic.Name, `${this.vacuumName} Cleaning`);
  }
  async handleSwitchOn(kind, options) {
    if (kind === "command" && options.command) {
      await this.sendDeviceCommand(options.command, "default");
      await this.updateVacuumStatus();
      return;
    }
    if (kind === "room" && options.sceneId) {
      await this.executeScene(options.sceneId);
      await this.updateVacuumStatus();
      return;
    }
    if (kind === "powerLevel" && typeof options.powerLevel === "number") {
      await this.sendDeviceCommand("PowLevel", options.powerLevel.toString());
      return;
    }
    throw new Error(`Unsupported accessory action: ${kind}`);
  }
  unregisterStaleAccessories(expectedUuids) {
    const staleAccessories = [...this.accessories.values()].filter((accessory) => !expectedUuids.has(accessory.UUID));
    if (staleAccessories.length === 0) {
      return;
    }
    this.api.unregisterPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, staleAccessories);
    for (const accessory of staleAccessories) {
      this.accessories.delete(accessory.UUID);
    }
    this.log.info(`Removed ${staleAccessories.length} stale SwitchBot K10+ accessory/accessories from the cache.`);
  }
  startStatusPolling() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
    }
    this.statusTimer = setInterval(() => {
      void this.updateVacuumStatus();
    }, this.pollIntervalSeconds * 1e3);
  }
  async updateVacuumStatus() {
    const cleanUuid = this.api.hap.uuid.generate(`${ACCESSORY_PREFIX}-${this.deviceId}-command-clean`);
    const cleanAccessory = this.accessories.get(cleanUuid);
    if (!cleanAccessory) {
      return;
    }
    try {
      const status = await this.callSwitchBot(`/v1.1/devices/${this.deviceId}/status`, "GET");
      this.applyVacuumStatus(cleanAccessory, status);
    } catch (error) {
      this.log.warn(`Unable to update SwitchBot K10+ status: ${this.formatError(error)}`);
    }
  }
  applyVacuumStatus(accessory, status) {
    const battery = typeof status.battery === "number" ? Math.max(0, Math.min(100, status.battery)) : void 0;
    const online = status.onlineStatus !== "offline";
    const workingStatus = status.workingStatus ?? "";
    const isCleaning = CLEANING_STATUSES.has(workingStatus);
    const isCharging = CHARGING_STATUSES.has(workingStatus);
    const batteryService = accessory.getService(this.Service.BatteryService);
    if (batteryService && battery !== void 0) {
      batteryService.updateCharacteristic(this.Characteristic.BatteryLevel, battery);
      batteryService.updateCharacteristic(
        this.Characteristic.StatusLowBattery,
        battery <= LOW_BATTERY_THRESHOLD ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
      );
      batteryService.updateCharacteristic(
        this.Characteristic.ChargingState,
        isCharging ? this.Characteristic.ChargingState.CHARGING : this.Characteristic.ChargingState.NOT_CHARGING
      );
    }
    const cleaningService = accessory.getServiceById(this.Service.OccupancySensor, "cleaning");
    if (cleaningService) {
      cleaningService.updateCharacteristic(
        this.Characteristic.OccupancyDetected,
        isCleaning ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      );
      cleaningService.updateCharacteristic(
        this.Characteristic.StatusActive,
        online
      );
    }
  }
  async sendDeviceCommand(command, parameter) {
    await this.callSwitchBot(`/v1.1/devices/${this.deviceId}/commands`, "POST", {
      command,
      parameter,
      commandType: "command"
    });
    this.log.info(`Sent SwitchBot K10+ command: ${command}`);
  }
  async executeScene(sceneId) {
    await this.callSwitchBot(`/v1.1/scenes/${sceneId}/execute`, "POST", {});
    this.log.info(`Executed SwitchBot scene: ${sceneId}`);
  }
  async callSwitchBot(path, method, body) {
    const t = Date.now().toString();
    const nonce = import_crypto.default.randomUUID();
    const payload = body ? JSON.stringify(body) : void 0;
    const sign = import_crypto.default.createHmac("sha256", this.secret).update(`${this.token}${t}${nonce}`).digest("base64");
    const response = await fetch(`${SWITCHBOT_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json; charset=utf8",
        "sign-type": "HMAC-SHA256",
        t,
        nonce,
        sign
      },
      body: method === "GET" ? void 0 : payload
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : void 0;
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }
    if (!json) {
      throw new Error("SwitchBot returned an empty response.");
    }
    if (json.statusCode !== 100) {
      throw new Error(`SwitchBot API error ${json.statusCode}: ${json.message ?? "Unknown error"}`);
    }
    return json.body;
  }
  formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }
};
module.exports = (api) => {
  api.registerPlatform(PLUGIN_IDENTIFIER, PLATFORM_NAME, SwitchBotK10PlusVacuumPlatform);
};
