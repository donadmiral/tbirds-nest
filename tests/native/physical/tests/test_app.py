"""Bounded fixture-backed UX on an installed physical Android application.

Uses the real React Native screens, media player, disk, and process lifecycle.
Network responses are synthetic. Does not certify hosted capacity or backend parity.
"""
import base64
import json
import os
import subprocess
from pathlib import Path
import time
import urllib.error
import urllib.request

BASE = os.environ.get('APPIUM_URL', 'http://127.0.0.1:4723/wd/hub')
PACKAGE = 'app.platinumcircles.mobile.qa'
OUTPUT = Path(os.environ.get('DEVICEFARM_LOG_DIR', '.')) / 'platinum-physical'
OUTPUT.mkdir(parents=True, exist_ok=True)


def request(method, path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, raw, {'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            value = json.load(response).get('value')
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()[:1500]) from error
    if isinstance(value, dict) and value.get('error'):
        raise RuntimeError(str(value))
    return value


def run():
    if not os.environ.get('DEVICEFARM_DEVICE_UDID'):
        raise RuntimeError('Device Farm device identity required for physical acceptance')
    qemu = subprocess.check_output(['adb', 'shell', 'getprop', 'ro.kernel.qemu'], timeout=10).decode().strip()
    abi = subprocess.check_output(['adb', 'shell', 'getprop', 'ro.product.cpu.abi'], timeout=10).decode().strip()
    if qemu == '1' or abi != 'arm64-v8a':
        raise RuntimeError('Expected a physical ARM64 Android device')
    capabilities = {'platformName': 'Android', 'appium:automationName': 'UiAutomator2',
                    'appium:appPackage': PACKAGE, 'appium:appActivity': '.MainActivity',
                    'appium:noReset': False, 'appium:newCommandTimeout': 90,
                    'appium:autoGrantPermissions': False}
    if os.environ.get('DEVICEFARM_APP_PATH'):
        capabilities['appium:app'] = os.environ['DEVICEFARM_APP_PATH']
    created = request('POST', '/session', {'capabilities': {'alwaysMatch': capabilities, 'firstMatch': [{}]}})
    session = created['sessionId']
    prefix = '/session/' + session
    results = []
    passed = False
    started = time.monotonic()

    def command(method, path, body=None):
        return request(method, prefix + path, body)

    def wait_element(using, value, seconds=30):
        deadline = time.monotonic() + seconds
        last = None
        while time.monotonic() < deadline:
            try:
                found = command('POST', '/element', {'using': using, 'value': value})
                return found['element-6066-11e4-a52e-4f735466cecf']
            except RuntimeError as error:
                last = error
                time.sleep(1)
        raise AssertionError('Element unavailable: ' + value) from last

    def text(value, seconds=30):
        return wait_element('-android uiautomator', 'new UiSelector().text(' + json.dumps(value) + ')', seconds)

    def identifier(value, seconds=30):
        return wait_element('-android uiautomator', 'new UiSelector().resourceId(' + json.dumps(value) + ')', seconds)

    def click(element):
        command('POST', '/element/' + element + '/click', {})

    def snapshot(name):
        (OUTPUT / (name + '.png')).write_bytes(base64.b64decode(command('GET', '/screenshot')))
        (OUTPUT / (name + '.xml')).write_text(command('GET', '/source'))

    def mobile(script, args):
        return command('POST', '/execute/sync', {'script': 'mobile: ' + script, 'args': [args]})

    def record(name):
        results.append({'name': name, 'elapsedSeconds': round(time.monotonic() - started, 3), 'passed': True})
        snapshot(name)

    try:
        email = wait_element('-android uiautomator', 'new UiSelector().className("android.widget.EditText").instance(0)', 90)
        command('POST', '/element/' + email + '/value', {'text': 'qa.alex@example.invalid'})
        try:
            command('POST', '/appium/device/hide_keyboard', {})
        except RuntimeError:
            pass
        password = wait_element('-android uiautomator', 'new UiSelector().className("android.widget.EditText").instance(1)')
        command('POST', '/element/' + password + '/value', {'text': 'FixtureOnly-2026!'})
        try:
            command('POST', '/appium/device/hide_keyboard', {})
        except RuntimeError:
            pass
        click(text('Sign in'))
        text('A quiet morning in the desert. Small moments worth keeping.', 45)
        record('signed-in-feed')
        size = command('GET', '/window/rect')
        width, height = int(size['width']), int(size['height'])
        region = {'left': int(width * .1), 'top': int(height * .30), 'width': int(width * .8), 'height': int(height * .48)}
        # Bring the actual native player into its production visibility threshold.
        mobile('scrollGesture', dict(region, direction='down', percent=.40))
        wait_element('accessibility id', 'Native feed video playing', 30)
        record('native-video-playing')
        mobile('scrollGesture', dict(region, direction='down', percent=1.0))
        click(identifier('main-tab-feed'))
        text('Your story')
        # A real pull-to-refresh gesture through the production list handler.
        command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'finger', 'parameters': {'pointerType': 'touch'}, 'actions': [
            {'type': 'pointerMove', 'duration': 0, 'x': width // 2, 'y': int(height * .42)},
            {'type': 'pointerDown', 'button': 0}, {'type': 'pause', 'duration': 150},
            {'type': 'pointerMove', 'duration': 700, 'x': width // 2, 'y': int(height * .85)},
            {'type': 'pointerUp', 'button': 0}]}]})
        text('A quiet morning in the desert. Small moments worth keeping.')
        mobile('scrollGesture', dict(region, direction='down', percent=.40))
        wait_element('accessibility id', 'Native feed video playing', 30)
        record('video-survives-refresh')
        click(identifier('main-tab-messages'))
        wait_element('-android uiautomator', 'new UiSelector().textContains("Ready for our next adventure?")')
        record('messages-navigation')
        click(identifier('main-tab-feed'))
        wait_element('accessibility id', 'Native feed video playing', 30)
        record('video-resumes-after-navigation')
        mobile('terminateApp', {'appId': PACKAGE})
        mobile('activateApp', {'appId': PACKAGE})
        text('A quiet morning in the desert. Small moments worth keeping.', 45)
        record('cold-relaunch-retains-session-feed')
        assert len(results) == 6
        passed = True
    except Exception:
        try:
            snapshot('failure')
        except Exception:
            pass
        raise
    finally:
        receipt = {'passed': passed, 'checks': results, 'physicalDevice': True,
                   'deviceName': os.environ.get('DEVICEFARM_DEVICE_NAME'), 'abi': abi, 'qemu': qemu, 'deviceOS': os.environ.get('DEVICEFARM_DEVICE_OS_VERSION'),
                   'fixtureBackend': True, 'realProviderAcceptance': False, 'offlineOriginalMediaAcceptance': False,
                   'scope': 'Installed full ARM64 application, native video, refresh, navigation and cold relaunch with synthetic account data.'}
        (OUTPUT / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        try:
            request('DELETE', prefix)
        except Exception:
            pass


def test_physical_app():
    run()


if __name__ == '__main__':
    run()
