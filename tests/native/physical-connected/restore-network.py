"""Post-test fallback preserves the phone's exact recorded pre-test radio settings."""
import json
import os
from pathlib import Path
import subprocess

source = Path(os.environ['DEVICEFARM_LOG_DIR']) / 'platinum-connected/network-before.json'
if source.is_file():
    state = json.loads(source.read_text())
    for command, key in [(['cmd', 'connectivity', 'airplane-mode'], 'airplane_mode_on'),
                         (['svc', 'wifi'], 'wifi_on'), (['svc', 'data'], 'mobile_data')]:
        subprocess.run(['adb', 'shell', *command, 'enable' if state[key] == '1' else 'disable'], check=True, timeout=15)
    print('Restored recorded pre-test network settings.')
