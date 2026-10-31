# Synthetic export image fixtures

These are original 8 × 8 solid-color fixtures, generated with Pillow 12.3.0.
`static.png` and `static.gif` contain one amber frame; `static.webp` contains one blue frame.
`animated.png`, `animated.webp` and `animated.gif` contain amber and blue
frames, each lasting 150 ms, with infinite looping. They contain no user media.

The tests inspect the actual encoded containers and deliberately serve some
files under different extensions/MIME labels. The browser tests also place them
in primary images, image stickers and CSS backgrounds. All GIF files are
intentionally excluded from video export, including the single-frame fixture.

To regenerate from the repository root with Pillow installed:

```python
from PIL import Image
from pathlib import Path
p = Path('web/tests/fixtures/export-images')
a = Image.new('RGB', (8, 8), (238, 180, 68))
b = Image.new('RGB', (8, 8), (26, 84, 164))
a.save(p / 'static.png')
b.save(p / 'static.webp', lossless=True)
for name in ['animated.png', 'animated.webp', 'animated.gif']:
    a.save(p / name, save_all=True, append_images=[b],
           duration=[150, 150], loop=0, **({'lossless': True} if name.endswith('.webp') else {}))
a.save(p / 'static.gif')
```
