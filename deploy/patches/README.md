# Local patches to Debian's LPrint and PAPPL

The Pi runs Debian's `lprint` 1.3.1 and `libpappl1t64` 1.3.1 rebuilt with these
patches. Both packages are `apt-mark hold` so upgrades don't replace them.

| Package | Patch | Why |
|---|---|---|
| lprint `1.3.1-1+eco2` | `lprint/0002-eco-printer-4x6-only-and-gap-sensing.patch` | Advertise only 4x6 media; send `^MNY` (gap sensing) for gap tracking. Upstream sends `^MNM` (black mark), which makes the ZP 450 feed blanks and pause. |
| | `lprint/0003-eco-printer-capture-page-bitmaps.patch` | Write each printed page as a 1-bit PBM to `/var/spool/lprint-capture/job-<id>-page-<n>.pbm` (only if that directory exists). Label Studio turns these into history previews and reprints, including for AirPrint jobs. |
| libpappl1t64 `1.3.1-2.1+eco1` | `pappl/0002-strings-languages-in-response.patch` | `printer-strings-languages-supported` was appended to the printer's attributes on every Get-Printer-Attributes request (fixed upstream in 1.4). |

## Rebuilding on the Pi

```sh
# once: enable deb-src and install build deps
sudo apt-get build-dep lprint pappl
mkdir -p ~/lprint-build && cd ~/lprint-build
apt-get source lprint            # or pappl
cd lprint-1.3.1
cp /path/to/deploy/patches/lprint/*.patch debian/patches/
ls debian/patches/*.patch | xargs -n1 basename | sort > debian/patches/series
dch --local +eco "Local eco-printer patches."
dpkg-buildpackage -b -us -uc
sudo dpkg -i ../lprint_*eco*_arm64.deb && sudo apt-mark hold lprint
sudo systemctl restart lprint
```

The capture directory is created by `deploy/provision.sh`
(`root:eco-studio`, mode `2770`).
