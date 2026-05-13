# homebridge-switchbot-k10plus-vacuum

Homebridge plugin for SwitchBot K10+ vacuum controls.

This plugin exposes SwitchBot K10+ actions to Apple Home as HomeKit switches. It supports:

- Whole-home cleaning with the SwitchBot device command API.
- Stop and return-to-dock controls.
- Optional suction/power-level switches using the SwitchBot `PowLevel` command.
- Battery, online, and cleaning-state polling on the main accessory.
- Room cleaning through manual scenes created in the SwitchBot app.

> Apple Home/Homebridge does not expose this plugin as a native vacuum tile. The controls are represented as switches and status services because the classic HomeKit services available to Homebridge do not provide a complete robot-vacuum service.

## Requirements

- Homebridge `1.7.0` or newer.
- Node.js `18.0.0` or newer.
- A SwitchBot OpenAPI token and secret.
- The SwitchBot device ID for your K10+ vacuum.

## Configuration

Example Homebridge platform configuration:

```json
{
  "platform": "SwitchBotK10PlusVacuum",
  "name": "SwitchBot K10+ Vacuum",
  "token": "YOUR_SWITCHBOT_TOKEN",
  "secret": "YOUR_SWITCHBOT_SECRET",
  "deviceId": "YOUR_K10_PLUS_DEVICE_ID",
  "enableStopSwitch": true,
  "enableDockSwitch": true,
  "pollIntervalSeconds": 300,
  "powerLevels": [
    {
      "name": "Vacuum Quiet Power",
      "value": 0
    },
    {
      "name": "Vacuum Standard Power",
      "value": 1
    },
    {
      "name": "Vacuum Strong Power",
      "value": 2
    }
  ],
  "rooms": [
    {
      "name": "Kitchen Clean",
      "sceneId": "YOUR_KITCHEN_SCENE_ID"
    },
    {
      "name": "Living Room Clean",
      "sceneId": "YOUR_LIVING_ROOM_SCENE_ID"
    }
  ]
}
```

### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `platform` | Yes | `SwitchBotK10PlusVacuum` | Homebridge platform alias. |
| `name` | No | `SwitchBot K10+ Vacuum` | Name used for status services. |
| `token` | Yes | none | SwitchBot OpenAPI token. |
| `secret` | Yes | none | SwitchBot OpenAPI secret. |
| `deviceId` | Yes | none | Device ID for the K10+ vacuum. |
| `enableStopSwitch` | No | `true` | Expose a momentary Stop switch. |
| `enableDockSwitch` | No | `true` | Expose a momentary Return to Dock switch. |
| `pollIntervalSeconds` | No | `300` | Status polling interval. Values below 60 seconds are raised to 60 seconds. |
| `powerLevels` | No | `[]` | Optional momentary switches that send the SwitchBot `PowLevel` command. |
| `rooms` | No | `[]` | Optional room switches backed by manual SwitchBot scenes. |

## Room cleaning

The public SwitchBot K10+ API supports basic device commands such as `start`, `stop`, `dock`, and `PowLevel`. Room-specific cleaning is implemented by executing manual SwitchBot scenes, so you need to create one scene per room or zone in the SwitchBot app and then add that scene ID to the `rooms` array.

If SwitchBot publishes a native room-cleaning command for this device in the future, the plugin can add a native room mode later. Until then, scene-based rooms are the safest documented approach.

## Status polling

The main Clean accessory also includes status services:

- Battery level and low-battery state.
- Charging state when SwitchBot reports charging or fully charged.
- An occupancy-style cleaning indicator that is active while the vacuum reports a cleaning/running status.
- Online status through the cleaning indicator's active/inactive status.

SwitchBot applies API rate limits, so avoid setting `pollIntervalSeconds` too low.

## Troubleshooting

### Install fails with `git dep preparation failed` or `ENOTDIR`

Version `1.0.3` briefly added an npm `prepare` script. On some Homebridge/npm installs, especially when installing from a Git URL, npm runs `prepare` as a nested install step and can fail before Homebridge gets the plugin. Version `1.0.4` removes that install-time prepare step and ships the rebuilt `dist` bundle directly.

If npm also reports `ENOTDIR: not a directory, rename .../node_modules/homebridge-switchbot-k10plus-vacuum`, remove the broken existing install path and reinstall the plugin:

```sh
sudo rm -rf /usr/local/lib/node_modules/homebridge-switchbot-k10plus-vacuum
sudo npm install -g homebridge-switchbot-k10plus-vacuum
```

If you see repeated `TAR_ENTRY_ERROR ENOENT` warnings under `.../homebridge-switchbot-k10plus-vacuum/node_modules/@matter/...`, npm is trying to install Homebridge and its Matter dependencies inside this plugin. Version `1.0.5` removes the Homebridge peer dependency so npm does not auto-install a nested Homebridge copy for the plugin.

If your Homebridge uses a different global npm prefix, replace `/usr/local/lib/node_modules` with the path shown in the npm error.


### Commands do nothing

Check the Homebridge log. The plugin validates HTTP failures and SwitchBot API errors and logs the reason when a command or status refresh fails.

### Room switches do nothing

Room switches execute SwitchBot scenes. Confirm that:

1. The scene is a manual scene in the SwitchBot app.
2. The scene runs correctly from the SwitchBot app.
3. The configured `sceneId` matches the scene you want to run.

### Old room switches remain in HomeKit

Restart Homebridge after changing the `rooms` or `powerLevels` arrays. The plugin removes cached accessories that no longer exist in the current configuration during startup.
