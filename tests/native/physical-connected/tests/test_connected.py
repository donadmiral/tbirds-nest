"""Real QA auth, first-party original downloads and decoded encrypted-cache cold launch."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

BASE = os.environ.get('APPIUM_URL', 'http://127.0.0.1:4723/wd/hub')
PACKAGE = 'app.platinumcircles.mobile.qa'
OUTPUT = Path(os.environ.get('DEVICEFARM_LOG_DIR', '.')) / 'platinum-connected'

def adb(*args, binary=False):
    value = subprocess.check_output(['adb', *args], timeout=15)
    return value if binary else value.decode().strip()

def request(method, path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, raw, {'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            value = json.load(response).get('value')
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()[:1200]) from error
    if isinstance(value, dict) and value.get('error'):
        raise RuntimeError(str(value))
    return value

def test_connected_original_cache():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    config_path = Path(__file__).parents[1] / 'connected-canary.json'
    assert config_path.is_file(), 'Exact reviewed QA canary configuration required'
    config = json.loads(config_path.read_text())
    assert config['projectId'] == 'uaulhuelcfkjwojtymmw'
    assert config['base'] == 'https://uaulhuelcfkjwojtymmw.supabase.co'
    assert config['firstRankedFeedPost'] and config['snapshotEligible']
    assert len(config['media']) == 2 and {item['kind'] for item in config['media']} == {'image', 'video'}
    assert os.environ.get('DEVICEFARM_DEVICE_UDID'), 'Device Farm identity required'
    abi, qemu = adb('shell', 'getprop', 'ro.product.cpu.abi'), adb('shell', 'getprop', 'ro.kernel.qemu')
    assert abi == 'arm64-v8a' and qemu != '1', 'Actual physical ARM64 device required'
    app_path = Path(os.environ['DEVICEFARM_APP_PATH'])
    app_hash = hashlib.sha256(app_path.read_bytes()).hexdigest()
    assert app_hash == config['apkSha256'], 'Installed APK must match the reviewed source receipt'
    before_network = {key: adb('shell', 'settings', 'get', 'global', key) for key in ('airplane_mode_on', 'wifi_on', 'mobile_data')}
    (OUTPUT / 'network-before.json').write_text(json.dumps(before_network, indent=2) + '\n')
    caps = {'platformName': 'Android', 'appium:automationName': 'UiAutomator2', 'appium:appPackage': PACKAGE,
            'appium:appActivity': '.MainActivity', 'appium:app': str(app_path), 'appium:noReset': False,
            'appium:autoGrantPermissions': False, 'appium:newCommandTimeout': 90}
    session = request('POST', '/session', {'capabilities': {'alwaysMatch': caps, 'firstMatch': [{}]}})['sessionId']
    prefix = '/session/' + session
    started, results, proofs = time.monotonic(), [], {}
    passed, network_changed, network_restored = False, False, False
    cold_process = None
    media = {item['kind']: item for item in config['media']}

    def command(method, path, body=None):
        return request(method, prefix + path, body)

    def wait(check, seconds=30, message='Condition unavailable'):
        deadline, last = time.monotonic() + seconds, None
        while time.monotonic() < deadline:
            try:
                value = check()
                if value:
                    return value
            except (RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
                last = error
            time.sleep(.7)
        raise AssertionError(message) from last

    def element(using, value, seconds=30):
        def locate():
            found = command('POST', '/element', {'using': using, 'value': value})['element-6066-11e4-a52e-4f735466cecf']
            return found if command('GET', '/element/' + found + '/displayed') else None
        return wait(locate, seconds, 'Visible element unavailable: ' + value)

    def text(value, seconds=30):
        return element('-android uiautomator', 'new UiSelector().text(' + json.dumps(value) + ')', seconds)

    def identifier(value, seconds=30):
        return element('-android uiautomator', 'new UiSelector().resourceId(' + json.dumps(value) + ')', seconds)

    def click(found):
        command('POST', '/element/' + found + '/click', {})

    def mobile(script, args):
        return command('POST', '/execute/sync', {'script': 'mobile: ' + script, 'args': [args]})

    def permission():
        try:
            prompt = element('id', 'com.android.permissioncontroller:id/permission_message', 5)
        except AssertionError:
            return
        assert command('GET', '/element/' + prompt + '/text') == 'Allow Platinum QA to send you notifications?'
        try:
            deny = element('id', 'com.android.permissioncontroller:id/permission_deny_button', 2)
        except AssertionError:
            deny = element('id', 'com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button', 5)
        click(deny)

    def observer():
        return json.loads(adb('exec-out', 'run-as', PACKAGE, 'cat', 'files/connected-physical-receipt.json'))

    def events(kind):
        return [row for row in observer()['events'] if row['type'] == kind]

    def displayed(kind, local=False, seconds=35):
        label = 'Native feed ' + kind + (' displayed ' if kind == 'image' else ' playing ')
        tail = ' ' + media[kind]['mediaId']
        if local:
            return element('accessibility id', label + 'decrypted-local' + tail, seconds)
        selector = 'new UiSelector().descriptionStartsWith(' + json.dumps(label) + ').descriptionContains(' + json.dumps(tail) + ')'
        return element('-android uiautomator', selector, seconds)

    def rect(found):
        return command('GET', '/element/' + found + '/rect')

    def swipe_media(kind, direction):
        box = rect(identifier('native-feed-image-' + media['image']['mediaId']) if kind == 'image' else identifier('native-feed-video'))
        y = int(box['y'] + box['height'] * .52)
        start, end = (.85, .15) if direction == 'left' else (.15, .85)
        command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'carousel', 'parameters': {'pointerType': 'touch'}, 'actions': [
            {'type': 'pointerMove', 'duration': 0, 'x': int(box['x'] + box['width'] * start), 'y': y},
            {'type': 'pointerDown', 'button': 0},
            {'type': 'pointerMove', 'duration': 500, 'x': int(box['x'] + box['width'] * end), 'y': y},
            {'type': 'pointerUp', 'button': 0}]}]})

    def main_tab(name):
        try:
            found = identifier(name, 2)
        except AssertionError:
            size = command('GET', '/window/rect')
            command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'tabs', 'parameters': {'pointerType': 'touch'}, 'actions': [
                {'type': 'pointerMove', 'duration': 0, 'x': int(size['width'] * .5), 'y': int(size['height'] * .40)},
                {'type': 'pointerDown', 'button': 0},
                {'type': 'pointerMove', 'duration': 500, 'x': int(size['width'] * .5), 'y': int(size['height'] * .55)},
                {'type': 'pointerUp', 'button': 0}]}]})
            found = identifier(name, 5)
        click(found)

    def refresh():
        before = len([row for row in events('http-result') if row.get('path') == '/rest/v1/rpc/get_feed' and row.get('status') == 200])
        size = command('GET', '/window/rect')
        command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'refresh', 'parameters': {'pointerType': 'touch'}, 'actions': [
            {'type': 'pointerMove', 'duration': 0, 'x': int(size['width'] * .5), 'y': int(size['height'] * .42)},
            {'type': 'pointerDown', 'button': 0}, {'type': 'pause', 'duration': 150},
            {'type': 'pointerMove', 'duration': 700, 'x': int(size['width'] * .5), 'y': int(size['height'] * .85)},
            {'type': 'pointerUp', 'button': 0}]}]})
        wait(lambda: len([row for row in events('http-result') if row.get('path') == '/rest/v1/rpc/get_feed' and row.get('status') == 200]) > before,
             35, 'The real refresh did not complete a QA get_feed request')

    def screenshot(name):
        (OUTPUT / (name + '.png')).write_bytes(base64.b64decode(command('GET', '/screenshot')))
        (OUTPUT / (name + '.xml')).write_text(command('GET', '/source'))
        (OUTPUT / (name + '-observer.json')).write_text(json.dumps(observer(), indent=2) + '\n')

    def receipt():
        value = {'passed': passed, 'checks': results, 'proofs': proofs, 'physicalDevice': True, 'deviceName': os.environ.get('DEVICEFARM_DEVICE_NAME'),
                 'deviceOS': os.environ.get('DEVICEFARM_DEVICE_OS_VERSION'), 'abi': abi, 'qemu': qemu,
                 'apkSha256': app_hash, 'sourceCommit': config['sourceCommit'], 'runId': config['runId'],
                 'harnessSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'fixtureBackend': False,
                 'connectedQaProject': config['projectId'], 'offlineOriginalMediaAcceptance': passed,
                 'networkRestored': network_restored, 'scope': 'One public image/video carousel, actual QA auth/capabilities, native encryption, refresh and offline cold decoded media.'}
        (OUTPUT / 'receipt.json').write_text(json.dumps(value, indent=2) + '\n')

    def record(name):
        results.append({'name': name, 'elapsedSeconds': round(time.monotonic() - started, 3), 'passed': True})
        receipt()
        screenshot(name)

    def file_proofs(cold=False):
        evidence = []
        for kind, item in media.items():
            entries = [row for row in events('cache-opened') if row.get('mediaId') == item['mediaId'] and row.get('postId') == config['postId']]
            assert entries, 'Actual native decryption observation required for ' + kind
            row = entries[-1]
            assert row['sourceVersion'] == item['sourceVersion'] and row['sourceClass'] == 'decrypted-local'
            assert re.fullmatch(r'[a-f0-9]{64}\.bin', row['cipherFile'])
            assert re.fullmatch(r'[a-f0-9]{64}\.(png|mp4)', row['plainFile'])
            sealed = adb('exec-out', 'run-as', PACKAGE, 'cat', 'cache/pc-offline-v1/sealed/' + row['cipherFile'], binary=True)
            clear = adb('exec-out', 'run-as', PACKAGE, 'cat', 'cache/pc-offline-v1/active/' + row['plainFile'], binary=True)
            clear_hash, sealed_hash = hashlib.sha256(clear).hexdigest(), hashlib.sha256(sealed).hexdigest()
            assert len(clear) == item['bytes'] and clear_hash == item['sha256'], 'Decrypted bytes must match actual QA-delivered original'
            assert len(sealed) == len(clear) + 28 and sealed_hash != clear_hash, 'AES-GCM nonce/tag ciphertext required'
            if cold:
                previous = next(value for value in proofs['warmFiles'] if value['kind'] == kind)
                assert sealed_hash == previous['sealedSha256'], 'Cold playback must reuse the retained ciphertext'
            evidence.append({'kind': kind, 'mediaId': item['mediaId'], 'sourceVersion': item['sourceVersion'],
                             'plainSha256': clear_hash, 'sealedSha256': sealed_hash, 'plainBytes': len(clear), 'sealedBytes': len(sealed)})
        return evidence

    def restore_network():
        nonlocal network_restored
        if network_changed:
            adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable' if before_network['airplane_mode_on'] == '1' else 'disable')
            adb('shell', 'svc', 'wifi', 'enable' if before_network['wifi_on'] == '1' else 'disable')
            adb('shell', 'svc', 'data', 'enable' if before_network['mobile_data'] == '1' else 'disable')
            wait(lambda: all(adb('shell', 'settings', 'get', 'global', key) == expected for key, expected in before_network.items() if expected in ('0', '1')),
                 15, 'Original physical device network settings did not restore')
        network_restored = True

    try:
        command('POST', '/appium/settings', {'settings': {'waitForIdleTimeout': 1000}})
        assert command('GET', '/appium/settings')['waitForIdleTimeout'] == 1000
        assert adb('shell', 'run-as', PACKAGE, 'id').startswith('uid='), 'Guarded debuggable QA identity required for targeted cache evidence'
        email = element('-android uiautomator', 'new UiSelector().className("android.widget.EditText").instance(0)', 90)
        command('POST', '/element/' + email + '/value', {'text': config['email']})
        try:
            command('POST', '/appium/device/hide_keyboard', {})
        except RuntimeError:
            pass
        password = element('-android uiautomator', 'new UiSelector().className("android.widget.EditText").instance(1)')
        command('POST', '/element/' + password + '/value', {'text': config['password']})
        try:
            command('POST', '/appium/device/hide_keyboard', {})
        except RuntimeError:
            pass
        click(text('Sign in'))
        permission()
        text(config['caption'], 45)
        displayed('image')
        record('online-image-displayed')
        wait(lambda: {row.get('mediaId') for row in events('cache-sealed') if row.get('postId') == config['postId']} == {item['mediaId'] for item in media.values()},
             45, 'Both actual first-party originals must complete native encrypted storage')
        displayed('image', local=True)
        swipe_media('image', 'left')
        displayed('video')
        record('online-video-playing')
        swipe_media('video', 'right')
        displayed('image', local=True)
        refresh()
        displayed('image', local=True)
        assert 'Your feed could not load' not in command('GET', '/source')
        record('refresh-retains-displayed-image')
        main_tab('main-tab-messages')
        text('Messages')
        main_tab('main-tab-feed')
        text(config['caption'])
        displayed('image', local=True)
        swipe_media('image', 'left')
        displayed('video')
        proofs['warmFiles'] = file_proofs()
        record('navigation-retains-decoded-originals')
        swipe_media('video', 'right')
        displayed('image', local=True)
        warm_process = observer()['process']
        mobile('terminateApp', {'appId': PACKAGE})
        network_changed = True
        adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable')
        adb('shell', 'svc', 'wifi', 'disable')
        adb('shell', 'svc', 'data', 'disable')
        wait(lambda: adb('shell', 'settings', 'get', 'global', 'airplane_mode_on') == '1'
             and adb('shell', 'settings', 'get', 'global', 'wifi_on') == '0'
             and adb('shell', 'settings', 'get', 'global', 'mobile_data') == '0', 15, 'Physical network disable readback failed')
        proofs['offlineSettings'] = {key: adb('shell', 'settings', 'get', 'global', key) for key in before_network}
        mobile('activateApp', {'appId': PACKAGE})
        permission()
        text(config['caption'], 45)
        displayed('image', local=True)
        cold_process = observer()['process']
        assert cold_process != warm_process, 'A new JavaScript/native app process is required'
        wait(lambda: any(row.get('isConnected') is False for row in events('network-state')), 15, 'App must observe an actual disconnected network')
        record('offline-cold-image-decrypted-and-displayed')
        swipe_media('image', 'left')
        displayed('video', local=True)
        proofs['offlineEndSettings'] = {key: adb('shell', 'settings', 'get', 'global', key) for key in before_network}
        assert proofs['offlineEndSettings'] == {'airplane_mode_on': '1', 'wifi_on': '0', 'mobile_data': '0'}
        assert events('network-state')[-1].get('isConnected') is False, 'Cold decoded media must remain offline'
        progress = wait(lambda: [row for row in events('video-progress') if row.get('mediaId') == media['video']['mediaId']
                        and row.get('sourceClass') == 'decrypted-local' and row.get('firstFrame') and row.get('playing')]
                        if len([row for row in events('video-progress') if row.get('mediaId') == media['video']['mediaId']
                                and row.get('sourceClass') == 'decrypted-local']) >= 2 else None,
                        10, 'Two advancing native video samples after a decoded cold frame are required')
        assert len(progress) == 2 and progress[1]['currentTime'] > progress[0]['currentTime'] + .1
        proofs['coldVideoProgress'] = [{'nativeSeconds': row['currentTime'], 'elapsedMs': row['elapsedMs']} for row in progress]
        first_image = next(row for row in events('image-displayed') if row.get('mediaId') == media['image']['mediaId'] and row.get('sourceClass') == 'decrypted-local')
        proofs['coldImageOnDisplayElapsedMs'] = first_image['elapsedMs']
        assert not events('cache-sealed'), 'Offline cold process must not download new originals'
        assert not [row for row in events('http-result') if row.get('status', 999) < 400], 'Offline cold process must not have a successful hosted request'
        proofs['coldFiles'] = file_proofs(cold=True)
        record('offline-cold-video-decrypted-and-playing')
        restore_network()
        swipe_media('video', 'right')
        displayed('image', local=True)
        refresh()
        wait(lambda: events('network-state')[-1].get('isConnected') is True, 15, 'App did not observe restored QA reachability')
        displayed('image', local=True)
        assert 'Your feed could not load' not in command('GET', '/source')
        record('restored-network-refresh-retains-image')
        assert len(results) == 7
        passed = True
    except BaseException:
        try:
            screenshot('failure')
        except Exception:
            pass
        raise
    finally:
        try:
            restore_network()
        except BaseException:
            passed, network_restored = False, False
            raise
        finally:
            receipt()
            try:
                request('DELETE', prefix)
            except Exception:
                pass
