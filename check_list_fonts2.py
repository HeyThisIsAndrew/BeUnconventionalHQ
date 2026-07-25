import sys
sys.path.append('venv/lib/python3.14/site-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.mutator import instantiateVariableFont

font = TTFont("node_modules/@fontsource-variable/syne/files/syne-latin-wght-normal.woff2")
cmap = font.getBestCmap()
units_per_em = font['head'].unitsPerEm

def get_width(text, weight, font_size_in):
    var_font = instantiateVariableFont(font, {"wght": weight})
    var_hmtx = var_font['hmtx']
    width = 0
    for char in text:
        glyph_name = cmap.get(ord(char))
        if glyph_name:
            width += var_hmtx.metrics[glyph_name][0]
    return (width / units_per_em) * font_size_in

tests = [
    ("On-The-Ground Convention & Premiere Coverage", 400, 0.12),
    ("Cinematic Video Essays & Reviews", 400, 0.12),
    ("Editorial independence on all coverage", 400, 0.12),
    ("Full disclosure of provided materials", 400, 0.12),
]
print("Column Available Width: ~3.5in")
for t1, w1, s1 in tests:
    w = get_width(t1, w1, s1)
    print(f"'{t1}': {w:.3f}in")
