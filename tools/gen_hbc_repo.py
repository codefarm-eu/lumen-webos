#!/usr/bin/env python3
"""Writes a Homebrew Channel repository for one .ipk: <out>/apps.json (the index the Channel reads, same format as
https://repo.webosbrew.org/api/apps.json) and <out>/<id>.manifest.json. Used by .github/workflows/release.yml.
Usage: gen_hbc_repo.py <ipk> <ipk-url> <base-url-of-out-dir> <out-dir>"""
import hashlib, json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ipk, ipk_url, base, out = sys.argv[1:5]
info = json.load(open(f'{ROOT}/app/dist/appinfo.json'))
os.makedirs(out, exist_ok=True)
shutil.copy(f'{ROOT}/app/dist/largeIcon.png', f'{out}/icon.png')
manifest = {
    'id': info['id'], 'version': info['version'], 'type': 'web', 'title': info['title'],
    'appDescription': info.get('appDescription', ''), 'iconUri': f'{base}/icon.png',
    'sourceUrl': 'https://github.com/' + os.environ.get('GITHUB_REPOSITORY', 'ovsteenb/lumen-webos'), 'rootRequired': True,
    'ipkUrl': ipk_url, 'ipkHash': {'sha256': hashlib.sha256(open(ipk, 'rb').read()).hexdigest()}, 'ipkSize': os.path.getsize(ipk),
}
name = f"{info['id']}.manifest.json"
json.dump(manifest, open(f'{out}/{name}', 'w'), indent=2)
package = {
    'id': info['id'], 'title': info['title'], 'iconUri': manifest['iconUri'], 'manifestUrl': f'{base}/{name}', 'manifest': manifest,
    'pool': 'main', 'shortDescription': manifest['appDescription'],
}
index = {'paging': {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': 1, 'prevUrl': None, 'nextUrl': None}, 'packages': [package]}
json.dump(index, open(f'{out}/apps.json', 'w'), indent=2)
print(f"{out}/apps.json: {info['id']} {info['version']}")
