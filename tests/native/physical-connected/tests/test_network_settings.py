"""A stale singleton preference must not mask a dual-SIM phone's real data state."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('physical_network_settings_unit', Path(__file__).parents[1] / 'network_settings.py')
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)


def device(mode='dsds', sub='1', legacy='1', current='0'):
    values = {'multi_sim_data_call': sub, 'mobile_data': legacy, 'mobile_data' + sub: current,
              'airplane_mode_on': '1', 'wifi_on': '0'}
    def adb(*args):
        if args == ('shell', 'getprop', 'persist.radio.multisim.config'):
            return mode
        assert args[:4] == ('shell', 'settings', 'get', 'global')
        return values.get(args[4], 'null')
    return adb, values


def test_dual_sim_reads_disabled_subscription_when_legacy_stays_enabled():
    adb, _ = device()
    binding = network.discover_binding(adb)
    assert binding['mobileDataSettingKey'] == 'mobile_data1'
    assert network.read_settings(adb, binding) == {'airplane_mode_on': '1', 'wifi_on': '0', 'mobile_data': '0'}


def test_single_sim_uses_actual_singleton_preference():
    adb, values = device(mode='')
    values['mobile_data'] = '0'
    assert network.discover_binding(adb)['mobileDataSettingKey'] == 'mobile_data'


def test_missing_or_changed_subscription_fails_closed():
    adb, values = device(sub='-1')
    with pytest.raises(AssertionError, match='Valid default data subscription'):
        network.discover_binding(adb)
    adb, values = device()
    binding = network.discover_binding(adb)
    values['multi_sim_data_call'] = '2'
    with pytest.raises(AssertionError, match='subscription changed'):
        network.read_settings(adb, binding)


def test_restoration_reads_original_subscription_preference():
    adb, values = device(current='1')
    binding = network.discover_binding(adb)
    before = network.read_settings(adb, binding)
    values['mobile_data1'] = '0'
    assert network.read_settings(adb, binding) != before
    values['mobile_data1'] = '1'
    assert network.read_settings(adb, binding) == before


def test_sim_mode_change_rejects_a_stale_binding():
    adb, _ = device()
    binding = network.discover_binding(adb)
    single_sim_adb, _ = device(mode='')
    with pytest.raises(AssertionError, match='SIM configuration changed'):
        network.validate_binding(single_sim_adb, binding)
