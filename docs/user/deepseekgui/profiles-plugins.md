# Profiles and plugins

English | [中文](profiles-plugins.zh.md)

Harness Profiles define the runtime composition an agent uses. DeepSeekGUI discovers those Profiles and manages plugins through the official Harness commands; it does not maintain a second plugin system.

## Managed and Existing Homes

DeepSeekGUI can run one of two Harness Home types:

- **Managed Home** is the application-owned Home under DeepSeekGUI's data directory. It is the recommended starting point and receives DeepSeekGUI's safe defaults.
- **Existing Home** is an absolute DSH Home path you choose. DeepSeekGUI discovers and runs its Profiles in place without copying, merging, or migrating them.

The Harness panel shows the active Home, full path, Profile, and runtime status. Switching Home or Profile restarts Harness and can interrupt a running task, so DeepSeekGUI asks for confirmation when something is currently running.

## Choose a Profile

Open the Harness section in Settings and select a startable Profile. DeepSeekGUI distinguishes Web-capable, candidate, headless, and malformed Profiles instead of presenting every directory as runnable.

If a new Profile fails to start, DeepSeekGUI can return to the last known good selection. The recovery notice records the failed stage and target without pretending the attempted Profile succeeded.

![DeepSeekGUI Settings with general, model, plugin, and agent preset controls](assets/settings-panel.png)

## The Plugins page

Plugins are managed in **Settings → Plugins**. This is Harness's own plugin page, which DeepSeekGUI uses directly. It shows the active Profile:

- **Installed**: plugin packages installed in the Profile. You can inspect their components, enable or disable them, configure them, and remove them.
- **Official**: official plugins you can install directly.
- **Bundled with DeepSeekGUI**: plugins installed together with DeepSeekGUI (workbench, theme, settings, browser, Skills, and others). They carry a red "Cannot be removed" tag and cannot be disabled or removed, because DeepSeekGUI depends on them.

When adding a plugin you can choose the official source, a mirror, or a custom source. DeepSeekGUI installs with its bundled pnpm, so the computer does not need a separate pnpm installation. Most changes take effect the next time Harness starts; the page says so.

## Version compatibility check

When a plugin is installed or started, Harness checks the DSH versions the plugin declares support for. An incompatible plugin is refused, and the page states the reason. If you must use an incompatible version, you can grant an exemption for that exact plugin version and that exact DSH version only. This can break the application or corrupt data; do it only for a source you trust.

## When a plugin stops Harness from starting

When Harness fails to start, DeepSeekGUI shows a dialog naming the stage that failed, with the paths of the diagnostics log and the event record (the event record is `<DSH_HOME>/deepseekgui/events.md`). If you installed a plugin recently, suspect that installation first: remove it from the DSH terminal with `dsh plugin --profile <Profile> remove <package>`, then restart Harness.

## Related guides

- [Permissions and approvals](permissions.md)
- [Desktop tools](desktop-tools.md)
- [Data and troubleshooting](data-troubleshooting.md)
