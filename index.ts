import {
  API,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import crypto from 'crypto';

type RoomConfig = {
  name: string;
  sceneId: string;
};

type SwitchBotPlatformConfig = PlatformConfig & {
  name?: string;
  token: string;
  secret: string;
  deviceId?: string;
  rooms?: RoomConfig[];
};

const PLATFORM_NAME = 'SwitchBotK10PlusVacuum';
const ACCESSORY_PREFIX = 'SwitchBotK10PlusVacuum';
const DEFAULT_DEVICE_ID = '360TY420703040884';
const SWITCHBOT_BASE_URL = 'https://api.switch-bot.com';

export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, SwitchBotK10PlusVacuumPlatform);
};

class SwitchBotK10PlusVacuumPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof HAP['Characteristic'];
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly rooms: RoomConfig[];
  private readonly token: string;
  private readonly secret: string;
  private readonly deviceId: string;

  constructor(
    private readonly log: Logger,
    private readonly config: SwitchBotPlatformConfig,
    private readonly api: API,
  ) {
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

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private async discoverAccessories(): Promise<void> {
    this.ensureAccessory('clean', 'Clean', 'master');
    for (const room of this.rooms) {
      this.ensureAccessory(`room-${room.sceneId}`, room.name, 'room', room.sceneId);
    }
  }

  private ensureAccessory(uniqueSuffix: string, name: string, kind: 'master' | 'room', sceneId?: string): void {
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
      .onSet(async (value: CharacteristicValue) => {
        if (value) {
          if (kind === 'master') {
            await this.callSwitchBot(`/v1.1/devices/${this.deviceId}/commands`, 'POST', {
              command: 'start',
              parameter: 'default',
              commandType: 'command',
            });
          } else if (sceneId) {
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

  private async callSwitchBot(path: string, method: string, body: Record<string, unknown>) {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const payload = JSON.stringify(body);
    const sign = crypto.createHmac('sha256', this.secret)
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
