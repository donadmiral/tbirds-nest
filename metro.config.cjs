const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const config = getDefaultConfig(__dirname);

// The web and admin apps share this repo but are not part of the phone bundle: keep Metro out of their folders.
config.resolver.blockList = exclusionList([
  /[\\/]web[\\/].*/,
  /[\\/]admin-web[\\/].*/,
  /[\\/]supabase[\\/].*/,
  /[\\/]tests[\\/].*/,
]);

module.exports = config;
