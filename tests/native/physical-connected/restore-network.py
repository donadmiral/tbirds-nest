"""Post-test fallback preserves the phone's exact recorded pre-test radio settings."""
import json
import os
from pathlib import Path
import subprocess
import time
from network_settings import read_settings, validate_binding

def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=15).decode().strip()

source = Path(os.environ['DEVICEFARM_LOG_DIR']) / 'platinum-connected/network-before.json'
if source.is_file():
    state = json.loads(source.read_text())
    binding = json.loads(source.with_name('network-binding.json').read_text())
    for command, key in [(['cmd', 'connectivity', 'airplane-mode'], 'airplane_mode_on'),
                         (['svc', 'wifi'], 'wifi_on'), (['svc', 'data'], 'mobile_data')]:
        if key == 'mobile_data':
            validate_binding(adb, binding)
        subprocess.run(['adb', 'shell', *command, 'enable' if state[key] == '1' else 'disable'], check=True, timeout=15)
    deadline = time.monotonic() + 15
    while read_settings(adb, binding) != state:
        if time.monotonic() >= deadline:
            raise AssertionError('Post-test radio restoration did not match the original subscription settings')
        time.sleep(.5)
    print('Restored recorded pre-test network settings.')
