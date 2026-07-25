from fontTools.ttLib import TTFont

font = TTFont("node_modules/@fontsource-variable/syne/files/syne-latin-wght-normal.woff2")
cmap = font.getBestCmap()
hmtx = font['hmtx']
units_per_em = font['head'].unitsPerEm

# The user wants to check Syne 800 (wght 800).
# FontTools doesn't easily interpolate variable fonts for width checks without varLib,
# but usually character advances in Syne weight axes change. 
# We can use varLib.mutator if we want exact. Let's just do a basic mutator check.
from fontTools.varLib.mutator import instantiateVariableFont
var_font = instantiateVariableFont(font, {"wght": 800})
var_hmtx = var_font['hmtx']

def get_string_width(text):
    width = 0
    for char in text:
        glyph_name = cmap.get(ord(char))
        if glyph_name:
            width += var_hmtx.metrics[glyph_name][0]
    return width / units_per_em

strings = [
    "OF TRAFFIC FROM SEARCH",
    "320.1K TOTAL VIEWS",
    "Total Impressions",
    "Total Views"
]
for s in strings:
    print(f"'{s}': {get_string_width(s):.3f} ems")
