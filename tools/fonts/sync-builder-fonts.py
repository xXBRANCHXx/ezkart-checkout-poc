#!/usr/bin/env python3
"""Refresh self-hosted Latin font files and their OFL licenses from Google Fonts.

Run from any directory with Python 3. Standard library only. The committed manifest
records each source URL and SHA-256; normal builds never need this script/network.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote
import argparse, hashlib, json, re, time

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
    ('Roboto', 'sans', '100..900'),
    ('Source Sans 3', 'sans', '200..900'),
    ('Noto Sans', 'sans', '100..900'),
    ('Figtree', 'sans', '300..900'),
    ('Lexend', 'sans', '100..900'),
    ('Karla', 'sans', '200..800'),
    ('Mulish', 'sans', '200..1000'),
    ('Jost', 'sans', '100..900'),
    ('Heebo', 'sans', '100..900'),
    ('Cabin', 'sans', '400..700'),
    ('Assistant', 'sans', '200..800'),
    ('IBM Plex Sans', 'sans', '100..700'),
    ('Public Sans', 'sans', '100..900'),
    ('Red Hat Display', 'sans', '300..900'),
    ('Epilogue', 'sans', '100..900'),
    ('Hanken Grotesk', 'sans', '100..900'),
    ('Albert Sans', 'sans', '100..900'),
    ('Onest', 'sans', '100..900'),
    ('Geist', 'sans', '100..900'),
    ('Wix Madefor Display', 'sans', '400..800'),
    ('Be Vietnam Pro', 'sans', '400;700'),
    ('Nunito Sans', 'sans', '200..1000'),
    ('Archivo', 'sans', '100..900'),
    ('Overpass', 'sans', '100..900'),
    ('Asap', 'sans', '100..900'),
    ('Signika', 'sans', '300..700'),
    ('Comfortaa', 'sans', '300..700'),
    ('Josefin Sans', 'sans', '100..700'),
    ('Titillium Web', 'sans', '400;700'),
    ('Chivo', 'sans', '100..900'),
    ('Dosis', 'sans', '200..800'),
    ('Exo 2', 'sans', '100..900'),
    ('Bodoni Moda', 'serif', '400..900'),
    ('Cinzel', 'serif', '400..900'),
    ('EB Garamond', 'serif', '400..800'),
    ('Crimson Pro', 'serif', '200..900'),
    ('Crimson Text', 'serif', '400;700'),
    ('Spectral', 'serif', '400;700'),
    ('Source Serif 4', 'serif', '200..900'),
    ('Noto Serif', 'serif', '100..900'),
    ('PT Serif', 'serif', '400;700'),
    ('Libre Caslon Text', 'serif', '400;700'),
    ('Libre Caslon Display', 'serif', '400'),
    ('DM Serif Text', 'serif', '400'),
    ('Zilla Slab', 'serif', '400;700'),
    ('Alegreya', 'serif', '400..900'),
    ('Alegreya SC', 'serif', '400;700'),
    ('Vollkorn', 'serif', '400..900'),
    ('Neuton', 'serif', '400;700'),
    ('Old Standard TT', 'serif', '400;700'),
    ('Prata', 'serif', '400'),
    ('Vidaloka', 'serif', '400'),
    ('Gelasio', 'serif', '400..700'),
    ('Literata', 'serif', '200..900'),
    ('Newsreader', 'serif', '200..800'),
    ('Lusitana', 'serif', '400;700'),
    ('Cardo', 'serif', '400;700'),
    ('Gloock', 'serif', '400'),
    ('Baskervville', 'serif', '400..700'),
    ('Instrument Serif', 'serif', '400'),
    ('Bree Serif', 'serif', '400'),
    ('Arvo', 'serif', '400;700'),
    ('Domine', 'serif', '400..700'),
    ('Rokkitt', 'serif', '100..900'),
    ('Abril Fatface', 'display', '400'),
    ('Alfa Slab One', 'display', '400'),
    ('Bungee', 'display', '400'),
    ('Bungee Shade', 'display', '400'),
    ('Monoton', 'display', '400'),
    ('Lobster', 'display', '400'),
    ('Lobster Two', 'display', '400;700'),
    ('Patua One', 'display', '400'),
    ('Passion One', 'display', '400;700'),
    ('Black Ops One', 'display', '400'),
    ('Russo One', 'display', '400'),
    ('Audiowide', 'display', '400'),
    ('Orbitron', 'display', '400..900'),
    ('Michroma', 'display', '400'),
    ('Press Start 2P', 'display', '400'),
    ('VT323', 'display', '400'),
    ('Silkscreen', 'display', '400;700'),
    ('Rubik Mono One', 'display', '400'),
    ('Bowlby One SC', 'display', '400'),
    ('Fugaz One', 'display', '400'),
    ('Chango', 'display', '400'),
    ('Bangers', 'display', '400'),
    ('Acme', 'display', '400'),
    ('Ranchers', 'display', '400'),
    ('Fredoka', 'display', '300..700'),
    ('Baloo 2', 'display', '400..800'),
    ('Lilita One', 'display', '400'),
    ('Titan One', 'display', '400'),
    ('Modak', 'display', '400'),
    ('Paytone One', 'display', '400'),
    ('Concert One', 'display', '400'),
    ('Carter One', 'display', '400'),
    ('Changa One', 'display', '400'),
    ('Knewave', 'display', '400'),
    ('Sedgwick Ave Display', 'display', '400'),
    ('Rye', 'display', '400'),
    ('UnifrakturMaguntia', 'display', '400'),
    ('Pirata One', 'display', '400'),
    ('Jacquard 24', 'display', '400'),
    ('Creepster', 'display', '400'),
    ('Ewert', 'display', '400'),
    ('Yeseva One', 'display', '400'),
    ('Staatliches', 'display', '400'),
    ('Squada One', 'display', '400'),
    ('Alumni Sans Pinstripe', 'display', '400'),
    ('Great Vibes', 'handwriting', '400'),
    ('Sacramento', 'handwriting', '400'),
    ('Qwigley', 'handwriting', '400'),
    ('Allura', 'handwriting', '400'),
    ('Alex Brush', 'handwriting', '400'),
    ('Kaushan Script', 'handwriting', '400'),
    ('Courgette', 'handwriting', '400'),
    ('Oleo Script', 'handwriting', '400;700'),
    ('Marck Script', 'handwriting', '400'),
    ('Damion', 'handwriting', '400'),
    ('Cookie', 'handwriting', '400'),
    ('Parisienne', 'handwriting', '400'),
    ('Tangerine', 'handwriting', '400;700'),
    ('Pinyon Script', 'handwriting', '400'),
    ('Italianno', 'handwriting', '400'),
    ('Petit Formal Script', 'handwriting', '400'),
    ('Rouge Script', 'handwriting', '400'),
    ('Niconne', 'handwriting', '400'),
    ('Mr De Haviland', 'handwriting', '400'),
    ('Mrs Saint Delafield', 'handwriting', '400'),
    ('Mr Dafoe', 'handwriting', '400'),
    ('Kristi', 'handwriting', '400'),
    ('Mansalva', 'handwriting', '400'),
    ('Indie Flower', 'handwriting', '400'),
    ('Shadows Into Light', 'handwriting', '400'),
    ('Patrick Hand', 'handwriting', '400'),
    ('Kalam', 'handwriting', '400;700'),
    ('Handlee', 'handwriting', '400'),
    ('Gloria Hallelujah', 'handwriting', '400'),
    ('Architects Daughter', 'handwriting', '400'),
    ('Gochi Hand', 'handwriting', '400'),
    ('Neucha', 'handwriting', '400'),
    ('Reenie Beanie', 'handwriting', '400'),
    ('La Belle Aurore', 'handwriting', '400'),
    ('Amatic SC', 'handwriting', '400;700'),
    ('Caveat Brush', 'handwriting', '400'),
    ('Edu NSW ACT Foundation', 'handwriting', '400..700'),
    ('JetBrains Mono', 'mono', '100..800'),
    ('Fira Code', 'mono', '300..700'),
    ('Fira Mono', 'mono', '400;700'),
    ('Source Code Pro', 'mono', '200..900'),
    ('Roboto Mono', 'mono', '100..700'),
    ('Inconsolata', 'mono', '200..900'),
    ('Victor Mono', 'mono', '100..700'),
    ('Anonymous Pro', 'mono', '400;700'),
    ('Cousine', 'mono', '400;700'),
    ('PT Mono', 'mono', '400'),
    ('DM Mono', 'mono', '400'),
    ('Red Hat Mono', 'mono', '300..700'),
    ('Azeret Mono', 'mono', '100..900'),
    ('Spline Sans Mono', 'mono', '300..700'),
    ('Martian Mono', 'mono', '100..800'),
    ('Geist Mono', 'mono', '100..900'),
    ('Cutive Mono', 'mono', '400'),
    ('Oxygen Mono', 'mono', '400'),
]
EXISTING = [
    ('Poppins','sans', [('poppins-'+str(w)+'.woff2',str(w)) for w in [400,500,600,700]],'OFL.txt'),
    ('Inter','sans',[('inter.woff2','100 900')],'inter-OFL.txt'),
    ('DM Sans','sans',[('dm-sans.woff2','100 900')],'dm-sans-OFL.txt'),
    ('Plus Jakarta Sans','sans',[('plus-jakarta-sans.woff2','400 800')],'plus-jakarta-sans-OFL.txt'),
    ('Manrope','sans',[('manrope.woff2','400 800')],'manrope-OFL.txt'),
    ('Anton','display',[('anton.woff2','400')],'anton-OFL.txt'),
]

FEATURED = ['Bebas Neue', 'DM Serif Display', 'Pacifico', 'Space Grotesk',
            'Bodoni Moda', 'Bungee', 'Caveat', 'Fraunces', 'Instrument Serif',
            'Alfa Slab One', 'Great Vibes', 'JetBrains Mono']
CACHE = {}

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
    cached = CACHE.get(name)
    if cached and cached.get('cssSource') == css_url and cached['category'] == category:
        files_match = all((DEST/face['file']).is_file() and checksum((DEST/face['file']).read_bytes()) == face['sha256'] for face in cached['faces'])
        if files_match and (DEST/cached['license']).is_file() and b'SIL OPEN FONT LICENSE' in (DEST/cached['license']).read_bytes().upper():
            return cached
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
    if b'SIL OPEN FONT LICENSE' not in license_text.upper(): raise ValueError('Missing OFL: '+name)
    (DEST/license_name).write_bytes(license_text)
    print(name, flush=True)
    return {'id':key,'name':name,'category':category,'faces':faces,'license':license_name,'licenseSource':license_url(name),'cssSource':css_url}

if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Redownload existing families as well as new ones.')
    args = parser.parse_args()
    DEST.mkdir(parents=True,exist_ok=True)
    manifest = DEST/'builder-fonts.json'
    if manifest.exists() and not args.refresh:
        CACHE.update({font['name']:font for font in json.loads(manifest.read_text())['families']})
    families = []
    for name,category,faces,license_name in EXISTING:
        families.append({'id':slug(name),'name':name,'category':category,'faces':[{'file':file,'weight':weight,'sha256':checksum((DEST/file).read_bytes())} for file,weight in faces], 'license':license_name,'licenseSource':license_url(name)})
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(download,entry):entry[0] for entry in NEW}
        for job in as_completed(jobs):
            try: families.append(job.result())
            except Exception as error: errors.append(f'{jobs[job]}: {error}')
    if errors: raise RuntimeError('Font download failed:\n'+'\n'.join(errors))
    assert len({font['name'] for font in families}) == len(families), 'Duplicate font family'
    families.sort(key=lambda font: (FEATURED.index(font['name']) if font['name'] in FEATURED else len(FEATURED), font['name'].casefold()))
    (DEST/'builder-fonts.json').write_text(json.dumps({'license':'SIL Open Font License 1.1','subset':'Latin (Indonesian and Western European text)','families':families},indent=2)+'\n')
    declarations = '\n'.join('@font-face{font-family:'+json.dumps(font['name'])+';src:url("assets/fonts/'+face['file']+'") format("woff2");font-weight:'+face['weight']+';font-style:normal;font-display:swap;}' for font in families for face in font['faces'])
    css = '/* Generated by tools/fonts/sync-builder-fonts.py; see assets/fonts/builder-fonts.json for licenses and provenance. */\n'+declarations+'\n'
    (ROOT/'cart/admin/builder-font-faces.css').write_text(css)
    # The hosted CSS cache lasts a week. A catalog update must also change its
    # imported URL so returning editors receive the new face declarations.
    picker_css = ROOT/'cart/admin/builder-fonts.css'
    versioned = '@import url("builder-font-faces.css?v='+checksum(css.encode())[:12]+'");'
    picker_css.write_text(re.sub(r'@import url\("builder-font-faces\.css(?:\?[^"\n]*)?"\);', versioned, picker_css.read_text()))
    print(f'{len(families)} families ready')
