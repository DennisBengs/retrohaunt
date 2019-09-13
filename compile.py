import http.client
import os
import subprocess
import sys
import time
import urllib

class UnsupportedVersion(Exception):
    pass

MIN_VERSION, VERSION_LESS_THAN = (3, 5), (4, 0)
if sys.version_info < MIN_VERSION or sys.version_info >= VERSION_LESS_THAN:
    raise UnsupportedVersion('requires Python %s,<%s' % ('.'.join(map(str, MIN_VERSION)), '.'.join(map(str, VERSION_LESS_THAN))))

__version__ = '1.0.1'

js_paths = [
    'public/jsfxr.js',
    'public/jsfxrsequencer.js',
    'public/audio.js',
    'public/levels.js',
    'public/common.js',
    'public/game.js']
js_bundle_original_path = 'release/bundle_original.js'
js_bundle_path = 'release/bundle.js'

release_file_paths = [
    './release/bundle.js',
    './release/index.html']
release_zip_path = 'release/retrohaunt.zip'

if os.path.exists(js_bundle_original_path):
    os.remove(js_bundle_original_path)
if os.path.exists(js_bundle_path):
    os.remove(js_bundle_path)
if os.path.exists(release_zip_path):
    os.remove(release_zip_path)

js_code = ''
for path in js_paths:
    with open(path) as js_file:
        js_code += js_file.read() + '\n'
js_code = js_code.replace("'use strict';", '')

parameters = urllib.parse.urlencode([
    ('js_code', js_code),
    ('compilation_level', 'ADVANCED_OPTIMIZATIONS'),
    ('language_out', 'ECMASCRIPT_2017'),
    ('output_format', 'text'),
    ('output_info', 'compiled_code'),
])

headers = { 'Content-type': 'application/x-www-form-urlencoded' }
conn = http.client.HTTPSConnection('closure-compiler.appspot.com')
conn.request('POST', '/compile', parameters, headers)
response = conn.getresponse()
js_compiled_code = response.read()
conn.close()

with open(js_bundle_original_path, 'w') as f:
    f.write(js_code)
with open(js_bundle_path, 'wb') as f:
    f.write(js_compiled_code)

subprocess.Popen([
    'C:/Program Files/7-Zip/7z.exe',
    'a',
    '-r',
    release_zip_path,
    ] + release_file_paths)

time.sleep(1)

print('Final size: %i bytes' % os.stat(release_zip_path).st_size)
