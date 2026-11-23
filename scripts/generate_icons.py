"""Generate AgentOS desktop application icons from the geometric monogram."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


def render_monogram(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(canvas_size * 0.08)
    radius = int(canvas_size * 0.22)
    draw.rounded_rectangle(
        [pad, pad, canvas_size - pad, canvas_size - pad],
        radius=radius,
        fill=(24, 24, 27, 255),
        outline=(55, 65, 81, 255),
        width=max(2, scale * 2),
    )

    stroke = max(4, int(canvas_size * 0.085))
    # Geometric A-chevron in Cobalt Ink (#2563EB) with crisp crossbar in warm off-white (#F3F2EE).
    left = (int(canvas_size * 0.30), int(canvas_size * 0.72))
    apex = (int(canvas_size * 0.50), int(canvas_size * 0.26))
    right = (int(canvas_size * 0.70), int(canvas_size * 0.72))
    draw.line([left, apex, right], fill=(59, 130, 246, 255), width=stroke, joint="curve")

    bar_y = int(canvas_size * 0.57)
    draw.line(
        [(int(canvas_size * 0.37), bar_y), (int(canvas_size * 0.63), bar_y)],
        fill=(243, 242, 238, 255),
        width=max(3, int(stroke * 0.85)),
    )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    icons_dir = repo_root / "apps" / "desktop" / "src-tauri" / "icons"
    assets_dir = repo_root / "assets"
    icons_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    render_monogram(32).save(icons_dir / "32x32.png")
    render_monogram(128).save(icons_dir / "128x128.png")
    render_monogram(256).save(icons_dir / "128x128@2x.png")
    render_monogram(512).save(icons_dir / "icon.png")
    render_monogram(512).save(assets_dir / "icon.png")

    ico_img = render_monogram(256)
    ico_img.save(
        icons_dir / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (128, 128), (256, 256)],
    )

    # Pillow writes valid Apple ICNS directly without needing macOS iconutil.
    icns_img = render_monogram(512)
    icns_img.save(icons_dir / "icon.icns", format="ICNS")

    leftover = icons_dir / "AgentOS.iconset"
    if leftover.exists():
        for child in leftover.iterdir():
            child.unlink()
        leftover.rmdir()
    print(f"Generated AgentOS desktop icons in {icons_dir}")


if __name__ == "__main__":
    main()
