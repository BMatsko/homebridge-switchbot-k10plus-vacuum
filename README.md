# homebridge-switchbot-k10plus-vacuum

Homebridge plugin for SwitchBot K10+ vacuum controls.

This plugin exposes SwitchBot K10+ actions to Apple Home as HomeKit switches. It supports:

- Whole-home cleaning with the SwitchBot device command API.
- Stop and return-to-dock controls.
- Optional suction/power-level switches using the SwitchBot `PowLevel` command.
- Battery, online, and cleaning-state polling on the main accessory.
- Room cleaning through manual scenes created in the SwitchBot app.

> Apple Home/Homebridge does not expose this plugin as a native vacuum tile. The controls are represented as switches and status services because the classic HomeKit services available to Homebridge do not provide a complete robot-vacuum service.


## Installation

### Homebridge UI

The easiest Homebridge UI installation path is available after this package is published to the npm registry. Search for `homebridge-switchbot-k10plus-vacuum` in Homebridge UI and install it like any other Homebridge plugin.

If Homebridge UI reports that the package cannot be found, the package has not been published to npm yet. In that case, install it from the terminal using one of the options below.

### Terminal install from npm

After the package is published to npm:

```sh
npm install -g homebridge-switchbot-k10plus-vacuum
```

### Terminal install from GitHub

You can deploy without publishing to npm by installing directly from the GitHub repository on the machine that runs Homebridge:

```sh
npm install -g github:poke/homebridge-switchbot-k10plus-vacuum
```

You can also use the full git URL if your npm version or environment does not resolve the GitHub shorthand:

```sh
npm install -g git+https://github.com/poke/homebridge-switchbot-k10plus-vacuum.git
```

The package includes a committed `dist/index.js` build for normal installs and a `prepare` script so git installs can rebuild `dist/index.js` when npm installs from the repository.

### Terminal install from a local tarball

For fully local installs, build a tarball and copy it to the Homebridge host:

```sh
git clone https://github.com/poke/homebridge-switchbot-k10plus-vacuum.git
cd homebridge-switchbot-k10plus-vacuum
npm install
npm run build
npm pack
npm install -g ./homebridge-switchbot-k10plus-vacuum-1.0.2.tgz
```

Restart Homebridge after installing from GitHub or a tarball so Homebridge can discover the plugin. If Homebridge is running in Docker, run the install command inside the Homebridge container or bake the tarball/GitHub install into your container image.

## Requirements

- Homebridge `1.7.0` or newer.
- Node.js `18.0.0` or newer.
- A SwitchBot OpenAPI token and secret.
- The SwitchBot device ID for your K10+ vacuum.


## Homebridge discovery troubleshooting

If you installed from the terminal but Homebridge does not show the plugin, check these common causes:

1. **Wrong install location:** Homebridge only discovers plugins installed in the Node/npm environment used by the Homebridge service. Compare `which homebridge`, `npm root -g`, and the npm prefix used by your Homebridge service.
2. **Docker installs:** If Homebridge runs in Docker, installing on the host OS is not enough. Install the plugin inside the container or add the install command to the image/container startup flow.
3. **Homebridge was not restarted:** Restart Homebridge after installing so the plugin manager reloads global packages.
4. **Missing platform config:** Add an entry under `platforms` with `"platform": "SwitchBotK10PlusVacuum"`. Homebridge will not instantiate the platform from install alone.
5. **Git install build failed:** For GitHub installs, check the terminal output for `prepare`/`npm run build` failures. A successful install should contain `dist/index.js`.
6. **Look for the registration log:** On startup, Homebridge should log a platform registration for `homebridge-switchbot-k10plus-vacuum.SwitchBotK10PlusVacuum`. If that line is missing, Homebridge did not load the package from its plugin search path.

Useful commands on the Homebridge host are:

```sh
npm root -g
npm list -g --depth=0 | grep homebridge-switchbot-k10plus-vacuum
homebridge -D
```

If you use `hb-service`, also check the service logs after restarting Homebridge.

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

### Commands do nothing

Check the Homebridge log. The plugin validates HTTP failures and SwitchBot API errors and logs the reason when a command or status refresh fails.

### Room switches do nothing

Room switches execute SwitchBot scenes. Confirm that:

1. The scene is a manual scene in the SwitchBot app.
2. The scene runs correctly from the SwitchBot app.
3. The configured `sceneId` matches the scene you want to run.

### Old room switches remain in HomeKit

Restart Homebridge after changing the `rooms` or `powerLevels` arrays. The plugin removes cached accessories that no longer exist in the current configuration during startup.
