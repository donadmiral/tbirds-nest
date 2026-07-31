/**
 * withVoipPushKit - the config plugin nobody published: wires PushKit
 * into the Swift AppDelegate so Apple VoIP pushes wake the app dead or
 * alive and report straight into CallKit before iOS's 5-second rule.
 * Pairs react-native-voip-push-notification with react-native-callkeep.
 */
const { withAppDelegate, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_EXTENSION = `
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(credentials, forType: type.rawValue)
  }
  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let d = payload.dictionaryPayload
    let uuid = (d["uuid"] as? String) ?? UUID().uuidString
    let name = (d["callerName"] as? String) ?? "Platinum Circles"
    let handle = (d["handle"] as? String) ?? "PlatinumCircles"
    let hasVideo = (d["hasVideo"] as? Bool) ?? false
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    RNCallKeep.reportNewIncomingCall(uuid, handle: handle, handleType: "generic", hasVideo: hasVideo,
      localizedCallerName: name, supportsHolding: false, supportsDTMF: false,
      supportsGrouping: false, supportsUngrouping: false, fromPushKit: true,
      payload: d, withCompletionHandler: completion)
  }
}
`;

function injectAppDelegate(contents) {
  let c = contents;
  if (!c.includes('import PushKit')) {
    c = c.replace(/(import Expo\s*\n)/, '$1import PushKit\n');
  }
  if (!c.includes('RNVoipPushNotificationManager.voipRegistration()')) {
    c = c.replace(/(didFinishLaunchingWithOptions[\s\S]*?\{)/, '$1\n    RNVoipPushNotificationManager.voipRegistration()\n');
  }
  if (!c.includes('PKPushRegistryDelegate')) {
    c = c + '\n' + SWIFT_EXTENSION;
  }
  return c;
}

const withVoipPushKit = (config) => {
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language === 'swift') {
      cfg.modResults.contents = injectAppDelegate(cfg.modResults.contents);
    }
    return cfg;
  });
  config = withDangerousMod(config, ['ios', async (cfg) => {
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const entries = fs.readdirSync(iosRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(iosRoot, e.name);
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('-Bridging-Header.h')) {
          const p = path.join(dir, f);
          let h = fs.readFileSync(p, 'utf8');
          let changed = false;
          for (const imp of ['#import "RNCallKeep.h"', '#import "RNVoipPushNotificationManager.h"']) {
            if (!h.includes(imp)) { h += '\n' + imp + '\n'; changed = true; }
          }
          if (changed) fs.writeFileSync(p, h);
        }
      }
    }
    return cfg;
  }]);
  return config;
};

module.exports = withVoipPushKit;