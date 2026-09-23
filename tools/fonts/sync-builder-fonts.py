#!/usr/bin/env python3
"""Refresh self-hosted Latin font files and their OFL licenses from Google Fonts.

Run from any directory with Python 3. Standard library only. The committed manifest
records each source URL and SHA-256; normal builds never need this script/network.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote
import hashlib, json, re, time

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'cart/admin/assets/fonts'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
NEW = [
    ('Outfit','sans','100..900'), ('Nunito','sans','200..1000'),
    ('Montserrat','sans','100..900'), ('Raleway','sans','100..900'),
    ('Lato','sans','400;700'), ('Open Sans','sans','300..800'),
    ('Work Sans','sans','100..900'), ('Urbanist','sans','100..900'),
    ('Rubik','sans','300..900'), ('Quicksand','sans','300..700'),
    ('Space Grotesk','sans','300..700'), ('Barlow','sans','400;700'),
    ('Sora','sans','100..800'), ('Playfair Display','serif','400..900'),
    ('Lora','serif','400..700'), ('Merriweather','serif','300..900'),
    ('Cormorant Garamond','serif','300..700'), ('DM Serif Display','serif','400'),
    ('Libre Baskerville','serif','400;700'), ('Fraunces','serif','100..900'),
    ('Bitter','serif','100..900'), ('Bebas Neue','display','400'),
    ('Archivo Black','display','400'), ('Oswald','display','200..700'),
    ('Righteous','display','400'), ('Caveat','handwriting','400..700'),
    ('Dancing Script','handwriting','400..700'), ('Pacifico','handwriting','400'),
    ('Space Mono','mono','400;700'), ('IBM Plex Mono','mono','400;700'),
]
EXISTING = [
    ('Poppins','sans', [('poppins-'+str(w)+'.woff2',str(w)) for w in [400,500,600,700]],'OFL.txt'),
    ('Inter','sans',[('inter.woff2','100 900')],'inter-OFL.txt'),
    ('DM Sans','sans',[('dm-sans.woff2','100 900')],'dm-sans-OFL.txt'),
    ('Plus Jakarta Sans','sans',[('plus-jakarta-sans.woff2','400 800')],'plus-jakarta-sans-OFL.txt'),
    ('Manrope','sans',[('manrope.woff2','400 800')],'manrope-OFL.txt'),
    ('Anton','display',[('anton.woff2','400')],'anton-OFL.txt'),
]

def fetch(url):
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'User-Agent':UA}), timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 3: raise
            time.sleep(attempt+1)

def checksum(data): return hashlib.sha256(data).hexdigest()
def slug(name): return name.lower().replace(' ','-')
def license_url(name): return 'https://raw.githubusercontent.com/google/fonts/main/ofl/'+name.lower().replace(' ','')+'/OFL.txt'

def download(entry):
    name, category, weights = entry
    key = slug(name)
    css_url = 'https://fonts.googleapis.com/css2?family='+quote(name)+':wght@'+weights+'&display=swap'
    css = fetch(css_url).decode()
    blocks = re.findall(r'/\* latin \*/\s*@font-face\s*\{([^}]+)\}', css)
    if not blocks: raise ValueError('No Latin WOFF2 faces for '+name)
    faces = []
    for block in blocks:
        url = re.search(r'src: url\(([^)]+)\)',block).group(1)
        weight = re.search(r'font-weight: ([^;]+)',block).group(1)
        if not url.endswith('.woff2'): raise ValueError('Not WOFF2: '+url)
        file = key+('' if len(blocks)==1 else '-'+weight.replace(' ','-'))+'.woff2'
        data = fetch(url)
        if data[:4] != b'wOF2': raise ValueError('Invalid font: '+name)
        (DEST/file).write_bytes(data)
        faces.append({'file':file,'weight':weight,'source':url,'sha256':checksum(data)})
    license_name = key+'-OFL.txt'
    license_text = fetch(license_url(name))
    if b'SIL OPEN FONT LICENSE' not in license_text: raise ValueError('Missing OFL: '+name)
    (DEST/license_name).write_bytes(license_text)
    print(name, flush=True)
    return {'id':key,'name':name,'category':category,'faces':faces,'license':license_name,'licenseSource':license_url(name),'cssSource':css_url}

if __name__=='__main__':
    DEST.mkdir(parents=True,exist_ok=True)
    families = []
    for name,category,faces,license_name in EXISTING:
        families.append({'id':slug(name),'name':name,'category':category,'faces':[{'file':file,'weight':weight,'sha256':checksum((DEST/file).read_bytes())} for file,weight in faces], 'license':license_name,'licenseSource':license_url(name)})
    with ThreadPoolExecutor(max_workers=4) as pool: families.extend(pool.map(download,NEW))
    (DEST/'builder-fonts.json').write_text(json.dumps({'license':'SIL Open Font License 1.1','subset':'Latin (Indonesian and Western European text)','families':families},indent=2)+'\n')
    declarations = '\n'.join('@font-face{font-family:'+json.dumps(font['name'])+';src:url("assets/fonts/'+face['file']+'") format("woff2");font-weight:'+face['weight']+';font-style:normal;font-display:swap;}' for font in families for face in font['faces'])
    (ROOT/'cart/admin/builder-font-faces.css').write_text('/* Generated by tools/fonts/sync-builder-fonts.py; see assets/fonts/builder-fonts.json for licenses and provenance. */\n'+declarations+'\n')
    print(f'{len(families)} families ready')
