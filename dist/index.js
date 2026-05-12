"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function() { return m[k]; } };
  }
  Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
  o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
  __setModuleDefault(result, mod);
  return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
  return (mod && mod.__esModule) ? mod : { "default": mod };
};
const homebridge_1 = require("homebridge");
const crypto_1 = __importDefault(require("crypto"));
const PLATFORM_NAME = 'SwitchBotK10PlusVacuum';
const ACCESSORY_PREFIX = 'SwitchBotK10PlusVacuum';
const DEFAULT_DEVICE_ID = '360TY420703040884';
const SWITCHBOT_BASE_URL = 'https://api.switch-bot.com';
module.exports = (api) => {
    api.registerPlatform(PLATFORM_NAME, SwitchBotK10PlusVacuumPlatform);
};
class SwitchBotK10PlusVacuumPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = new Map();
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.rooms = Array.isArray(config.rooms) ? config.rooms : [];
        this.token = config.token;
        this.secret = config.secret;
        this.deviceId = config.deviceId ?? DEFAULT_DEVICE_ID;
        this.api.on('didFinishLaunching', () => {
            void this.discoverAccessories();
        });
    }
    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }
    async discoverAccessories() {
        this.ensureAccessory('clean', 'Clean', 'master');
        for (const room of this.rooms) {
            this.ensureAccessory(`room-${room.sceneId}`, room.name, 'room', room.sceneId);
        }
    }
    ensureAccessory(uniqueSuffix, name, kind, sceneId) {
        const uuid = this.api.hap.uuid.generate(`${ACCESSORY_PREFIX}-${this.deviceId}-${uniqueSuffix}`);
        const existing = this.accessories.get(uuid);
        const accessory = existing ?? new this.api.platformAccessory(name, uuid);
        accessory.context.kind = kind;
        accessory.context.sceneId = sceneId;
        let service = accessory.getService(this.Service.Switch);
        if (!service) {
            service = accessory.addService(this.Service.Switch, name);
        }
        service.getCharacteristic(this.Characteristic.On)
            .onSet(async (value) => {
            if (value) {
                if (kind === 'master') {
                    await this.callSwitchBot(`/v1.1/devices/${this.deviceId}/commands`, 'POST', {
                        command: 'start',
                        parameter: 'default',
                        commandType: 'command',
                    });
                }
                else if (sceneId) {
                    await this.callSwitchBot(`/v1.1/scenes/${sceneId}/execute`, 'POST', {});
                }
                setTimeout(() => service?.updateCharacteristic(this.Characteristic.On, false), 1000);
            }
        });
        if (!existing) {
            this.api.registerPlatformAccessories('homebridge-switchbot-k10plus-vacuum', PLATFORM_NAME, [accessory]);
            this.accessories.set(uuid, accessory);
        }
    }
    async callSwitchBot(path, method, body) {
        const t = Date.now().toString();
        const nonce = crypto_1.default.randomUUID();
        const payload = JSON.stringify(body);
        const sign = crypto_1.default.createHmac('sha256', this.secret)
            .update(`${this.token}${t}${nonce}${payload}`)
            .digest('base64');
        await fetch(`${SWITCHBOT_BASE_URL}${path}`, {
            method,
            headers: {
                Authorization: this.token,
                'Content-Type': 'application/json',
                'sign-type': 'HMAC-SHA256',
                t,
                nonce,
                sign,
            },
            body: method === 'GET' ? undefined : payload,
        });
    }
}
