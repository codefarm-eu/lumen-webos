#!/usr/bin/env python3
"""Builds the .ipk that is published as a release: the stable app id, without app/private/ (no third-party icon tiles or logos, no private font,
the bundled public-domain paintings as default wallpapers).
Run: python3 tools/build_release.py   -> release/<id>_<version>_all.ipk"""
import glob, os, shutil, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(os.environ, LUMEN_PRIVATE='0', LUMEN_APP_ID='com.ovsteenb.lumen', LUMEN_APP_TITLE='Lumen', LUMEN_BUILD_DIR=f'{ROOT}/release')
subprocess.run(['sh', f'{ROOT}/tools/build_ipk.sh'], env=env, check=True)
print(glob.glob(f'{ROOT}/release/*.ipk'))
