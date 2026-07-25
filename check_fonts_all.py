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
    # Add small tracking/letter-spacing based on CSS
    # Let's say letter-spacing: 0.05em
    letter_spacing_in = font_size_in * 0.05
    # total letter spacing = (len(text) - 1) * letter_spacing_in
    return (width / units_per_em) * font_size_in + max(0, len(text)-1) * letter_spacing_in

# metric-value uses wght 800 (usually) and let's check its size
# metric-label uses wght 600, size 0.13in, letter-spacing 0.05em
print(f"Column available width: 2.366 in")
tests = [
    ("Search Traffic", 600, 0.13, 2.366),
    ("OF TRAFFIC FROM SEARCH", 600, 0.13, 2.366),
    ("Reviews & Criticism", 600, 0.13, 2.366),
    ("Streaming & Seasons", 600, 0.13, 2.366),
    ("Coverage & Analysis", 600, 0.13, 2.366),
]
for t, w, s, avail in tests:
    width = get_width(t, w, s)
    overflow = "OVERFLOW!" if width > avail else "Fits"
    print(f"'{t}': {width:.3f}in (Available: {avail:.3f}in) -> {overflow}")
