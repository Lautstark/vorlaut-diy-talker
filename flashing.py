#!/usr/bin/env python3
"""Getting the finished data/ onto the device.

Everything from here on is about the ESP32 and its flash, not about content:
finding the tools the Arduino IDE brought with it, packing data/ into a
LittleFS image, and writing that image into the right range of a whole-flash
image. Nothing in here reads layout.json or renders anything - it takes the
folder a build left behind and turns it into something esptool can write.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import config
from buildbase import BuildError, short

# Values from default_8MB.csv of the ESP32 core - the partition is called
# "spiffs" there, and that is exactly the one LittleFS mounts.
FS_SIZE = 0x180000       # 1536 KiB
FS_OFFSET = 0x670000
FS_IMAGE = config.SKETCH_DIR / "littlefs.bin"


def find_tool(name: str) -> Path | None:
    """Sucht ein Werkzeug im ESP32-Core der Arduino-IDE."""
    for base in (
        Path.home() / "Library/Arduino15/packages/esp32/tools",
        Path.home() / ".arduino15/packages/esp32/tools",
    ):
        folder = base / ("esptool_py" if name == "esptool" else name)
        if folder.exists():
            hits = sorted(folder.glob(f"*/{name}"))
            if hits:
                return hits[-1]
    return None


def build_fs_image() -> list[str]:
    """Packs firmware/vorlaut/data/ into a LittleFS image for flashing."""
    log: list[str] = []
    tool = find_tool("mklittlefs")
    if not tool:
        raise BuildError("build.err.no_mklittlefs")
    used = sum(f.stat().st_size for f in config.DATA_DIR.iterdir() if f.is_file())
    if used > FS_SIZE:
        raise BuildError("build.err.too_big", used=f"{used / 1024:.0f}",
                         fits=f"{FS_SIZE / 1024:.0f}")
    result = subprocess.run(
        [str(tool), "-c", str(config.DATA_DIR), "-b", "4096", "-p", "256",
         "-s", str(FS_SIZE), str(FS_IMAGE)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise BuildError("build.err.mklittlefs",
                         reason=result.stderr.strip()[:300])
    esptool = find_tool("esptool")
    call = str(esptool) if esptool else "esptool"
    for line in [
        f"Image: {short(FS_IMAGE)}  "
        f"({used / 1024:.0f} of {FS_SIZE / 1024:.0f} KiB used)",
        "Find the port with:  arduino-cli board list",
        "Write it with:",
        f"  {call} \\",
        f"    --chip esp32s3 --port /dev/cu.usbmodemXXXX \\",
        f"    write-flash 0x{FS_OFFSET:X} {short(FS_IMAGE)}",
    ]:
        log.append(line)
        print(line, flush=True)
    return log


def merge_fs_image(image: Path) -> list[str]:
    """Writes the LittleFS image into a whole-flash image at the spiffs offset.

    arduino-cli already pads vorlaut.ino.merged.bin out to the full 8 MB, so
    the file area is in that file already - as 1536 KiB of 0xFF. Filling it in
    means one write-flash at address 0 puts program *and* content onto the
    device, and a freshly flashed device speaks instead of showing "keine
    Inhalte".

    Deliberately not esptool merge-bin: that builds a new image out of its
    parts and would need every offset written down a second time. This changes
    exactly the range the partition table calls spiffs and leaves every byte
    around it alone.

    It refuses if that range is not blank. Then either the partition scheme is
    a different one or the program has grown into it, and in both cases
    writing anyway would produce an image that flashes cleanly and boots
    wrong - which is the one failure this whole path exists to avoid.
    """
    log: list[str] = []
    if not FS_IMAGE.exists():
        raise BuildError("build.err.not_found", name=short(FS_IMAGE))
    if not image.exists():
        raise BuildError("build.err.not_found", name=short(image))

    payload = FS_IMAGE.read_bytes()
    if len(payload) != FS_SIZE:
        raise BuildError("build.err.fs_size", found=str(len(payload)),
                         expected=str(FS_SIZE))

    flash = bytearray(image.read_bytes())
    end = FS_OFFSET + FS_SIZE
    if len(flash) < end:
        raise BuildError("build.err.image_short", name=short(image),
                         found=f"{len(flash) / 1024:.0f}",
                         needed=f"{end / 1024:.0f}")

    # Blank flash is 0xFF. Anything else in here is not padding.
    first_used = next((i for i, byte in enumerate(flash[FS_OFFSET:end])
                       if byte != 0xFF), None)
    if first_used is not None:
        raise BuildError("build.err.area_not_free",
                         offset=f"0x{FS_OFFSET + first_used:X}",
                         name=short(image))

    flash[FS_OFFSET:end] = payload
    image.write_bytes(bytes(flash))
    for line in [
        f"{short(FS_IMAGE)} written into {short(image)} at 0x{FS_OFFSET:X}.",
        "One command now flashes program and content together:",
        "  esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX \\",
        f"    write-flash 0x0 {image.name}",
    ]:
        log.append(line)
        print(line, flush=True)
    return log
