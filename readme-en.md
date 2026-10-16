# MusicFree Fork

[中文](./readme.md) | **English**

This is a personal fork of [maotoumao/MusicFree](https://github.com/maotoumao/MusicFree), based on upstream `v0.6.2` and currently released as `v0.6.3`. It keeps the upstream plugin-based player architecture and focuses on Android playback resilience, plugin management, and download observability.

> This repository is for personal use and study. It is not an official upstream release. The app does not bundle plugins or music sources.

## Fork-Specific Changes

### Playback source fallback and continuity
- Automatically retries with candidates from other enabled plugins when search, source resolution, or playback fails.
- Uses strict matching to reduce mistaken matches for songs with the same title.
- User-created playlists inherit fallback support and can keep a playlist-level source preference.
- Batch source switching and temporary-source display are available; resolved sources are cached.
- Timeout, failure, and track-change stop conditions prevent playback from blocking indefinitely.

### Plugin health management
- Plugins can be marked temporarily unavailable, manually invalid, or archived.
- Installation and updates preserve metadata, versions, subscription relationships, and source groups.
- Startup restores metadata first and mounts plugin code on demand.

### Plugin subscriptions and source groups
- Manage plugin subscriptions, updates, removal, and status.
- Version checks prevent accidental downgrades; duplicate lower-version plugins can be archived.
- Group plugins by local, network, or subscription origin with group-level actions.

### Batch availability testing
- Select several plugins and test them in one batch.
- A plugin remains available if either search or source resolution succeeds; dual failures are flagged automatically.

### Download result history
- Recent successful and failed downloads are recorded.
- The downloading page exposes status, time, and related track information.

## Download

Download Android APKs from [Releases](https://github.com/JayVae/MusicFree/releases). Use `app-universal-release.apk` if unsure; otherwise choose the APK matching your device ABI. Verify downloads with `SHA256SUMS.txt`.

Until official signing secrets are configured, CI builds use the repository debug keystore so the APK can be installed directly on personal devices. They are not intended for production distribution.

## Build

Node.js 20+, JDK 17, and the Android SDK are required.

```bash
npm ci
npx tsc --noEmit
npm test -- --passWithNoTests

# Debug
npm run android

# Release
cd android
GRADLE_USER_HOME="$USERPROFILE/.gradle" ./gradlew assembleRelease
```

## Legal notice

This project is only a player framework and does not include music sources. Plugins are supplied by users and remain the user's responsibility. Do not use this project to bypass paid services or copyright protections.

## Upstream and archived documentation

- Upstream project: <https://github.com/maotoumao/MusicFree>
- Original Chinese README: [`docs/archive/readme-upstream-v0.6.2.md`](./docs/archive/readme-upstream-v0.6.2.md)
- Original English README: [`docs/archive/readme-en-upstream-v0.6.2.md`](./docs/archive/readme-en-upstream-v0.6.2.md)

Licensed under [AGPL-3.0](./LICENSE). Thanks to [@maotoumao](https://github.com/maotoumao) and all upstream contributors.
