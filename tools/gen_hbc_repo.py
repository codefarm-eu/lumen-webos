#!/usr/bin/env python3
"""Writes a Homebrew Channel repository for one or more .ipk files: <out>/apps.json (the index the Channel reads, same format as
https://repo.webosbrew.org/api/apps.json), <out>/<id>.manifest.json and <out>/<id>.png per app. Each app's id, version, title and icon are
read from its own .ipk. Used by .github/workflows/release.yml (Lumen and Lumen bar).
Usage: gen_hbc_repo.py <out-dir> <base-url-of-out-dir> <ipk> <ipk-url> [<ipk> <ipk-url> ...]"""
import hashlib, io, json, os, sys, tarfile

def ar_members(data):
    assert data[:8] == b'!<arch>\n', 'not an ar archive'
    pos, out = 8, {}
    while pos + 60 <= len(data):
        name = data[pos:pos + 16].decode().strip().rstrip('/')
        size = int(data[pos + 48:pos + 58].decode().strip())
        out[name] = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)
    return out

def read_app(ipk):
    tar = tarfile.open(fileobj=io.BytesIO(ar_members(open(ipk, 'rb').read())['data.tar.gz']), mode='r:gz')
    names = tar.getnames()
    # usr/palm/applications/<id>/appinfo.json (with or without a leading ./)
    info_name = next(n for n in names if n.endswith('/appinfo.json') and n.lstrip('./').count('/') == 4 and n.lstrip('./').startswith('usr/palm/applications/'))
    info = json.load(tar.extractfile(info_name))
    folder = info_name[:-len('appinfo.json')]
    icon = None
    for key in ('largeIcon', 'icon'):
        if info.get(key) and folder + info[key] in names:
            icon = tar.extractfile(folder + info[key]).read()
            break
    return info, icon

out, base = sys.argv[1], sys.argv[2]
pairs = sys.argv[3:]
assert pairs and len(pairs) % 2 == 0, __doc__
os.makedirs(out, exist_ok=True)
packages = []
for ipk, ipk_url in zip(pairs[0::2], pairs[1::2]):
    info, icon = read_app(ipk)
    icon_uri = ''
    if icon:
        open(f"{out}/{info['id']}.png", 'wb').write(icon)
        icon_uri = f"{base}/{info['id']}.png"
        if not packages:   # the first app's icon also as icon.png, where earlier indexes pointed
            open(f'{out}/icon.png', 'wb').write(icon)
    manifest = {
        'id': info['id'], 'version': info['version'], 'type': 'web', 'title': info['title'],
        'appDescription': info.get('appDescription', ''), 'iconUri': icon_uri,
        'sourceUrl': 'https://github.com/' + os.environ.get('GITHUB_REPOSITORY', 'ovsteenb/lumen-webos'), 'rootRequired': True,
        'ipkUrl': ipk_url, 'ipkHash': {'sha256': hashlib.sha256(open(ipk, 'rb').read()).hexdigest()}, 'ipkSize': os.path.getsize(ipk),
    }
    name = f"{info['id']}.manifest.json"
    json.dump(manifest, open(f'{out}/{name}', 'w'), indent=2)
    packages.append({'id': info['id'], 'title': info['title'], 'iconUri': icon_uri, 'manifestUrl': f'{base}/{name}', 'manifest': manifest,
                     'pool': 'main', 'shortDescription': manifest['appDescription']})
    print(f"{out}: {info['id']} {info['version']}")
n = len(packages)
index = {'paging': {'page': 1, 'count': n, 'maxPage': 1, 'itemsTotal': n, 'prevUrl': None, 'nextUrl': None}, 'packages': packages}
json.dump(index, open(f'{out}/apps.json', 'w'), indent=2)
