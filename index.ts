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

type PowerLevelConfig = {
  name: string;
  value: number;
};

type SwitchBotPlatformConfig = PlatformConfig & {
  name?: string;
  token: string;
  secret: string;
  deviceId: string;
  rooms?: RoomConfig[];
  enableStopSwitch?: boolean;
  enableDockSwitch?: boolean;
  powerLevels?: PowerLevelConfig[];
  pollIntervalSeconds?: number;
};

type AccessoryKind = 'command' | 'room' | 'powerLevel';

type SwitchBotApiResponse<T = unknown> = {
  statusCode: number;
  message?: string;
  body?: T;
};

type VacuumStatus = {
  battery?: number;
  onlineStatus?: string;
  workingStatus?: string;
};

const PLATFORM_NAME = 'SwitchBotK10PlusVacuum';
const PLUGIN_IDENTIFIER = 'homebridge-switchbot-k10plus-vacuum';
const ACCESSORY_PREFIX = 'SwitchBotK10PlusVacuum';
const SWITCHBOT_BASE_URL = 'https://api.switch-bot.com';
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const MIN_POLL_INTERVAL_SECONDS = 60;
const LOW_BATTERY_THRESHOLD = 20;
const CLEANING_STATUSES = new Set(['Cleaning', 'Clearing', 'Working', 'Running']);
const CHARGING_STATUSES = new Set(['Charging', 'FullyCharged']);

export = (api: API) => {
  api.registerPlatform(PLUGIN_IDENTIFIER, PLATFORM_NAME, SwitchBotK10PlusVacuumPlatform);
};

class SwitchBotK10PlusVacuumPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof HAP['Characteristic'];
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly rooms: RoomConfig[];
  private readonly powerLevels: PowerLevelConfig[];
  private readonly token: string;
  private readonly secret: string;
  private readonly deviceId: string;
  private readonly vacuumName: string;
  private readonly enableStopSwitch: boolean;
  private readonly enableDockSwitch: boolean;
  private readonly pollIntervalSeconds: number;
  private statusTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly log: Logger,
    private readonly config: SwitchBotPlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.rooms = Array.isArray(config.rooms) ? config.rooms : [];
    this.powerLevels = Array.isArray(config.powerLevels) ? config.powerLevels : [];
    this.token = config.token;
    this.secret = config.secret;
    this.deviceId = config.deviceId;
    this.vacuumName = config.name || 'SwitchBot K10+ Vacuum';
    this.enableStopSwitch = config.enableStopSwitch !== false;
    this.enableDockSwitch = config.enableDockSwitch !== false;
    this.pollIntervalSeconds = Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number(config.pollIntervalSeconds) || DEFAULT_POLL_INTERVAL_SECONDS,
    );

    if (!this.token || !this.secret || !this.deviceId) {
      this.log.error('SwitchBot token, secret, and deviceId are required. No accessories will be registered.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      void this.discoverAccessories();
    });

    this.api.on('shutdown', () => {
      if (this.statusTimer) {
        clearInterval(this.statusTimer);
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private async discoverAccessories(): Promise<void> {
    const expectedUuids = new Set<string>();

    this.ensureAccessory(expectedUuids, 'command-clean', 'Clean', 'command', {
      command: 'start',
      includeStatusServices: true,
    });

    if (this.enableStopSwitch) {
      this.ensureAccessory(expectedUuids, 'command-stop', 'Stop', 'command', { command: 'stop' });
    }

    if (this.enableDockSwitch) {
      this.ensureAccessory(expectedUuids, 'command-dock', 'Return to Dock', 'command', { command: 'dock' });
    }

    for (const powerLevel of this.powerLevels) {
      this.ensureAccessory(expectedUuids, `power-${powerLevel.value}`, powerLevel.name, 'powerLevel', {
        powerLevel: powerLevel.value,
      });
    }

    for (const room of this.rooms) {
      this.ensureAccessory(expectedUuids, `room-${room.sceneId}`, room.name, 'room', { sceneId: room.sceneId });
    }

    this.unregisterStaleAccessories(expectedUuids);
    await this.updateVacuumStatus();
    this.startStatusPolling();
  }

  private ensureAccessory(
    expectedUuids: Set<string>,
    uniqueSuffix: string,
    name: string,
    kind: AccessoryKind,
    options: { command?: string; sceneId?: string; powerLevel?: number; includeStatusServices?: boolean },
  ): void {
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

  private updateAccessoryInformation(accessory: PlatformAccessory, name: string): void {
    accessory.getService(this.Service.AccessoryInformation)
      ?.setCharacteristic(this.Characteristic.Manufacturer, 'SwitchBot')
      .setCharacteristic(this.Characteristic.Model, 'K10+ Vacuum')
      .setCharacteristic(this.Characteristic.SerialNumber, this.deviceId)
      .setCharacteristic(this.Characteristic.Name, name);
  }

  private configureSwitchService(
    accessory: PlatformAccessory,
    name: string,
    kind: AccessoryKind,
    options: { command?: string; sceneId?: string; powerLevel?: number },
  ): void {
    const service = accessory.getService(this.Service.Switch) ?? accessory.addService(this.Service.Switch, name);
    service.setCharacteristic(this.Characteristic.Name, name);

    service.getCharacteristic(this.Characteristic.On).removeAllListeners('set');
    service.getCharacteristic(this.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        if (!value) {
          return;
        }

        await this.handleSwitchOn(kind, options);
        setTimeout(() => service.updateCharacteristic(this.Characteristic.On, false), 1000);
      });
  }

  private configureStatusServices(accessory: PlatformAccessory): void {
    const batteryService = accessory.getService(this.Service.BatteryService)
      ?? accessory.addService(this.Service.BatteryService, `${this.vacuumName} Battery`, 'battery');
    batteryService.setCharacteristic(this.Characteristic.Name, `${this.vacuumName} Battery`);

    const cleaningService = accessory.getServiceById(this.Service.OccupancySensor, 'cleaning')
      ?? accessory.addService(this.Service.OccupancySensor, `${this.vacuumName} Cleaning`, 'cleaning');
    cleaningService.setCharacteristic(this.Characteristic.Name, `${this.vacuumName} Cleaning`);
  }

  private async handleSwitchOn(
    kind: AccessoryKind,
    options: { command?: string; sceneId?: string; powerLevel?: number },
  ): Promise<void> {
    if (kind === 'command' && options.command) {
      await this.sendDeviceCommand(options.command, 'default');
      await this.updateVacuumStatus();
      return;
    }

    if (kind === 'room' && options.sceneId) {
      await this.executeScene(options.sceneId);
      await this.updateVacuumStatus();
      return;
    }

    if (kind === 'powerLevel' && typeof options.powerLevel === 'number') {
      await this.sendDeviceCommand('PowLevel', options.powerLevel.toString());
      return;
    }

    throw new Error(`Unsupported accessory action: ${kind}`);
  }

  private unregisterStaleAccessories(expectedUuids: Set<string>): void {
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

  private startStatusPolling(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
    }

    this.statusTimer = setInterval(() => {
      void this.updateVacuumStatus();
    }, this.pollIntervalSeconds * 1000);
  }

  private async updateVacuumStatus(): Promise<void> {
    const cleanUuid = this.api.hap.uuid.generate(`${ACCESSORY_PREFIX}-${this.deviceId}-command-clean`);
    const cleanAccessory = this.accessories.get(cleanUuid);

    if (!cleanAccessory) {
      return;
    }

    try {
      const status = await this.callSwitchBot<VacuumStatus>(`/v1.1/devices/${this.deviceId}/status`, 'GET');
      this.applyVacuumStatus(cleanAccessory, status);
    } catch (error) {
      this.log.warn(`Unable to update SwitchBot K10+ status: ${this.formatError(error)}`);
    }
  }

  private applyVacuumStatus(accessory: PlatformAccessory, status: VacuumStatus): void {
    const battery = typeof status.battery === 'number' ? Math.max(0, Math.min(100, status.battery)) : undefined;
    const online = status.onlineStatus !== 'offline';
    const workingStatus = status.workingStatus ?? '';
    const isCleaning = CLEANING_STATUSES.has(workingStatus);
    const isCharging = CHARGING_STATUSES.has(workingStatus);

    const batteryService = accessory.getService(this.Service.BatteryService);
    if (batteryService && battery !== undefined) {
      batteryService.updateCharacteristic(this.Characteristic.BatteryLevel, battery);
      batteryService.updateCharacteristic(
        this.Characteristic.StatusLowBattery,
        battery <= LOW_BATTERY_THRESHOLD
          ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
      batteryService.updateCharacteristic(
        this.Characteristic.ChargingState,
        isCharging ? this.Characteristic.ChargingState.CHARGING : this.Characteristic.ChargingState.NOT_CHARGING,
      );
    }

    const cleaningService = accessory.getServiceById(this.Service.OccupancySensor, 'cleaning');
    if (cleaningService) {
      cleaningService.updateCharacteristic(
        this.Characteristic.OccupancyDetected,
        isCleaning
          ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
      cleaningService.updateCharacteristic(
        this.Characteristic.StatusActive,
        online,
      );
    }
  }

  private async sendDeviceCommand(command: string, parameter: string): Promise<void> {
    await this.callSwitchBot(`/v1.1/devices/${this.deviceId}/commands`, 'POST', {
      command,
      parameter,
      commandType: 'command',
    });
    this.log.info(`Sent SwitchBot K10+ command: ${command}`);
  }

  private async executeScene(sceneId: string): Promise<void> {
    await this.callSwitchBot(`/v1.1/scenes/${sceneId}/execute`, 'POST', {});
    this.log.info(`Executed SwitchBot scene: ${sceneId}`);
  }

  private async callSwitchBot<T = unknown>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const payload = body ? JSON.stringify(body) : undefined;
    const sign = crypto.createHmac('sha256', this.secret)
      .update(`${this.token}${t}${nonce}`)
      .digest('base64');

    const response = await fetch(`${SWITCHBOT_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json; charset=utf8',
        'sign-type': 'HMAC-SHA256',
        t,
        nonce,
        sign,
      },
      body: method === 'GET' ? undefined : payload,
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) as SwitchBotApiResponse<T> : undefined;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    if (!json) {
      throw new Error('SwitchBot returned an empty response.');
    }

    if (json.statusCode !== 100) {
      throw new Error(`SwitchBot API error ${json.statusCode}: ${json.message ?? 'Unknown error'}`);
    }

    return json.body as T;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
