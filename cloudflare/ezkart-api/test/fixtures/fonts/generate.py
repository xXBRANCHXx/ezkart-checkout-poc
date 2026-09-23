"""Regenerate synthetic test fonts with fonttools[woff]. No third-party artwork."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

for ttf in (True, False):
    builder = FontBuilder(1000, isTTF=ttf)
    names = ['.notdef', 'space', 'A']
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({32: 'space', 65: 'A'})
    glyphs = {}
    for name in names:
        pen = TTGlyphPen(None) if ttf else T2CharStringPen(600, None)
        if name != 'space':
            pen.moveTo((100, 0))
            pen.lineTo((300, 700))
            pen.lineTo((500, 0))
            pen.closePath()
        glyphs[name] = pen.glyph() if ttf else pen.getCharString()
    builder.setupHorizontalMetrics({name: (600, 100) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Ezkart Test Font', 'styleName': 'Regular', 'uniqueFontIdentifier': 'EzkartTestFont', 'fullName': 'Ezkart Test Font', 'psName': 'EzkartTestFont'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    if ttf:
        builder.setupGlyf(glyphs)
    else:
        builder.setupCFF('EzkartTestFont', {'FullName': 'Ezkart Test Font', 'FamilyName': 'Ezkart Test Font', 'Weight': 'Regular'}, glyphs, {})
    builder.setupMaxp()
    builder.font['head'].created = builder.font['head'].modified = 3800000000
    for flavor in ([None, 'woff', 'woff2'] if ttf else [None]):
        builder.font.flavor = flavor
        builder.save(Path(__file__).with_name('sample.' + (flavor or ('ttf' if ttf else 'otf'))))
