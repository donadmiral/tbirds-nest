"""Read the mobile-data preference selected by Android's active SIM configuration.

Android GlobalSettingsHelper uses mobile_data<subId> for a valid subscription
on a multi-SIM phone. The unsuffixed legacy preference can remain unchanged.
This helper only reads settings. It never writes a value to satisfy a check.
"""
import re


def discover_binding(adb):
    mode = adb('shell', 'getprop', 'persist.radio.multisim.config')
    sub = adb('shell', 'settings', 'get', 'global', 'multi_sim_data_call')
    if mode in ('dsds', 'dsda', 'tsts'):
        assert re.fullmatch(r'\d+', sub), 'Valid default data subscription required on multi-SIM phone'
        key = 'mobile_data' + sub
    else:
        assert mode == '', 'Unknown SIM configuration cannot establish offline radio state'
        key = 'mobile_data'
    value = adb('shell', 'settings', 'get', 'global', key)
    assert value in ('0', '1'), 'Actual mobile-data preference must have a readable boolean value'
    return {'multiSimConfig': mode, 'defaultDataSubscriptionId': sub, 'mobileDataSettingKey': key}


def validate_binding(adb, binding):
    mode, sub = binding['multiSimConfig'], binding['defaultDataSubscriptionId']
    key = binding['mobileDataSettingKey']
    assert adb('shell', 'getprop', 'persist.radio.multisim.config') == mode, 'SIM configuration changed during the test'
    if mode in ('dsds', 'dsda', 'tsts'):
        assert re.fullmatch(r'\d+', sub) and key == 'mobile_data' + sub
        assert adb('shell', 'settings', 'get', 'global', 'multi_sim_data_call') == sub, 'Default data subscription changed during the test'
    else:
        assert mode == '' and key == 'mobile_data'


def read_settings(adb, binding):
    validate_binding(adb, binding)
    key = binding['mobileDataSettingKey']
    values = {name: adb('shell', 'settings', 'get', 'global', key if name == 'mobile_data' else name)
              for name in ('airplane_mode_on', 'wifi_on', 'mobile_data')}
    assert all(value in ('0', '1') for value in values.values()), 'All physical radio preferences must be readable'
    return values
